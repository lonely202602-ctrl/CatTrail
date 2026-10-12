/** LonelyCat 服务端：数据 API（服务端模式）+ 静态快照（演示模式）+ 同步触发 */
import Fastify from 'fastify';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, listRides } from './store/db.js';
import { writeIndexSnapshot } from './sync/sync.js';
import { buildClusters } from './clusters/cluster.js';
import { fetchUpstream, rewriteTileJSON, originOf } from './tiles/proxy.js';
import { hashPassword, verifyPassword, newToken, newUserId } from './auth.js';
import {
  countUsers, createUser, getUserByUsername, getUserById, setSession, getSessionUser, delSession,
  setIgpCreds, clearIgpCreds, claimOrphanRides, getRideRow, deleteRide, updateRideTitle,
} from './store/db.js';

/** 会话鉴权：Authorization: Bearer <token> → userId；失败返回 null（调用方回 401） */
function authUser(req: import('fastify').FastifyRequest): string | null {
  const h = req.headers.authorization ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return null;
  return getSessionUser(token);
}

function maskUsername(u: string): string {
  const at = u.indexOf('@');
  if (at > 0) {
    const local = u.slice(0, at);
    return `${local.slice(0, 2)}${'*'.repeat(Math.max(local.length - 2, 2))}${u.slice(at)}`;
  }
  return `${u.slice(0, 3)}${'*'.repeat(Math.max(u.length - 3, 2)).slice(0, 6)}`;
}
import type { RidesIndex, RideRecord } from '@lonelycat/shared';

const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = path.resolve(import.meta.dirname, process.env.DATA_DIR ?? '../../../data');

openDb();
const app = Fastify({ logger: { transport: undefined } });

// FIT 上传走原始二进制体
app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

function readStaticData(file: string): string | null {
  const p = path.join(DATA_DIR, file);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

function ridesOrSeed(userId: string): RideRecord[] {
  return listRides(userId);
}

app.get('/api/health', async () => ({ ok: true, ts: Date.now() }));

/** 骑行列表（与 data/index.json 同构；按用户隔离，含公开演示数据） */
app.get('/api/activities', async (req, reply) => {
  const uid = authUser(req);
  if (!uid) return reply.code(401).send({ error: '未登录' });
  const rides = ridesOrSeed(uid);
  const index: RidesIndex = {
    generatedAt: new Date().toISOString(),
    totalKm: Math.round(rides.reduce((s, r) => s + r.distanceKm, 0) * 100) / 100,
    totalAscentM: rides.reduce((s, r) => s + r.ascentM, 0),
    rides: rides.map(({ fitUrl: _f, track: _t, ...info }) => info),
  };
  return index;
});

/** 全部轨迹 FeatureCollection（与 data/tracks.json 同构；按用户隔离） */
app.get('/api/tracks', async (req, reply) => {
  const uid = authUser(req);
  if (!uid) return reply.code(401).send({ error: '未登录' });
  const rides = ridesOrSeed(uid);
  return {
    type: 'FeatureCollection',
    features: rides.map((r) => ({
      type: 'Feature',
      properties: {
        rideId: r.rideId,
        title: r.title,
        date: r.date,
        distanceKm: r.distanceKm,
        movingTimeSec: r.movingTimeSec,
        ascentM: r.ascentM,
        avgSpeedKmh: r.avgSpeedKmh,
        device: r.device,
      },
      geometry: { type: 'LineString', coordinates: r.track },
    })),
  };
});

/** 猫径：相似线路聚类（实时计算，与 data/clusters.json 同构；按用户隔离） */
app.get('/api/clusters', async (req, reply) => {
  const uid = authUser(req);
  if (!uid) return reply.code(401).send({ error: '未登录' });
  return buildClusters(ridesOrSeed(uid));
});

/** 逐秒序列（轨迹分析抽屉用；数据库优先，回退静态快照） */
app.get('/api/series/:rideId', async (req, reply) => {
  const uid = authUser(req);
  if (!uid) return reply.code(401).send({ error: '未登录' });
  const rideId = Number((req.params as { rideId: string }).rideId);
  if (!Number.isFinite(rideId)) return reply.code(400).send({ error: 'bad rideId' });
  const ride = listRides(uid).find((r) => r.rideId === rideId);
  if (ride?.series) return { rideId, series: ride.series };
  return reply.code(404).send({ error: 'not found' });
});

/** 静态快照直读（演示模式与 /data 契约） */
app.get('/data/:file', async (req, reply) => {
  const { file } = req.params as { file: string };
  if (!/^[\w-]+(\/[\w-]+)?\.json$/.test(file)) return reply.code(400).send({ error: 'bad file' });
  const raw = readStaticData(file);
  if (raw == null) return reply.code(404).send({ error: 'not found' });
  reply.header('content-type', 'application/json; charset=utf-8');
  return raw;
});

/** 瓦片直连代理（国内免代理）：/tiles/* → tiles.openfreemap.org/*，磁盘缓存。
 *  TileJSON（/tiles/planet）会重写瓦片地址到页面同源，浏览器全程不碰外网域名。 */
app.get('/tiles/*', async (req, reply) => {
  const rest = (req.params as { '*': string })['*'];
  // fastify 已对通配参数做 URL 解码（%20 → 空格），字体名含空格属正常；只拦 .. 防目录穿越
  if (rest.includes('..') || !/^[\w./% +()-]+$/.test(rest)) {
    return reply.code(400).send({ error: 'bad tile path' });
  }
  try {
    const entry = await fetchUpstream('/' + rest);
    if (rest === 'planet' && entry.status === 200) {
      reply.header('content-type', 'application/json; charset=utf-8');
      return rewriteTileJSON(entry.body.toString('utf8'), originOf(req.headers));
    }
    reply
      .code(entry.status)
      .header('content-type', entry.contentType)
      .header('cache-control', 'public, max-age=86400');
    return entry.body;
  } catch {
    return reply.code(504).send({ error: 'tile upstream unreachable' });
  }
});

/* ---------- 后台任务（同步等长耗时操作不阻塞页面） ---------- */
interface Job {
  userId: string;
  status: 'running' | 'done' | 'error';
  result?: unknown;
  error?: string;
  startedAt: number;
}
const jobs = new Map<string, Job>();

/** 触发同步：立即返回 jobId，后台执行；前端轮询 GET /api/jobs/:id */
app.post('/api/sync', async (req, reply) => {
  const uid = authUser(req);
  if (!uid) return reply.code(401).send({ error: '未登录' });
  const user = getUserById(uid);
  if (!user?.igp_u || !user?.igp_p) {
    return reply.code(400).send({ error: '未绑定 iGPSPORT 账号，请先在设置页绑定' });
  }
  // 同一用户同时只允许一个同步任务
  for (const j of jobs.values()) {
    if (j.userId === uid && j.status === 'running') {
      return reply.code(409).send({ error: '已有同步任务在进行中' });
    }
  }
  const jobId = newUserId();
  jobs.set(jobId, { userId: uid, status: 'running', startedAt: Date.now() });
  const { runSync } = await import('./sync/sync.js');
  runSync({ username: user.igp_u, password: user.igp_p, userId: uid })
    .then((summary) => {
      const j = jobs.get(jobId);
      if (j) {
        j.status = 'done';
        j.result = summary;
      }
    })
    .catch((e) => {
      const j = jobs.get(jobId);
      if (j) {
        j.status = 'error';
        j.error = String((e as Error).message ?? e);
      }
    });
  return { ok: true, jobId };
});

/** 查询后台任务状态 */
app.get('/api/jobs/:id', async (req, reply) => {
  const uid = authUser(req);
  if (!uid) return reply.code(401).send({ error: '未登录' });
  const job = jobs.get((req.params as { id: string }).id);
  if (!job || job.userId !== uid) return reply.code(404).send({ error: '任务不存在' });
  // 清理 30 分钟前的旧任务
  for (const [id, j] of jobs) {
    if (j.status !== 'running' && Date.now() - j.startedAt > 30 * 60e3) jobs.delete(id);
  }
  return { status: job.status, result: job.result, error: job.error };
});

/** iGPSPORT 账号绑定状态（绑定在当前用户名下，密码永不回传） */
app.get('/api/settings/igpsport', async (req, reply) => {
  const uid = authUser(req);
  if (!uid) return reply.code(401).send({ error: '未登录' });
  const user = getUserById(uid);
  if (user?.igp_u && user?.igp_p) {
    return { bound: true, source: 'stored', username: maskUsername(user.igp_u) };
  }
  return { bound: false, source: 'none', username: null };
});

/** 绑定/换绑：凭据绑定在当前用户名下（服务器数据库，不入仓库） */
app.post('/api/settings/igpsport', async (req, reply) => {
  const uid = authUser(req);
  if (!uid) return reply.code(401).send({ error: '未登录' });
  const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
  if (!username || !password) return reply.code(400).send({ error: '需要 username 与 password' });
  setIgpCreds(uid, username, password);
  return { ok: true, source: 'stored', username: maskUsername(username) };
});

/** 解绑 */
app.delete('/api/settings/igpsport', async (req, reply) => {
  const uid = authUser(req);
  if (!uid) return reply.code(401).send({ error: '未登录' });
  clearIgpCreds(uid);
  return { ok: true };
});

/** FIT 手动上传：解析 → 入库（归属当前用户）→ rideId 取起点时间，重传即覆盖 */
app.post('/api/activities/fit', async (req, reply) => {
  const uid = authUser(req);
  if (!uid) return reply.code(401).send({ error: '未登录' });
  const buf = req.body as Buffer;
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return reply.code(400).send({ error: '需要二进制 FIT 文件体（application/octet-stream）' });
  }
  try {
    const { ingestFitRide } = await import('./sync/sync.js');
    const summary = await ingestFitRide(buf, uid);
    return { ok: true, ...summary };
  } catch (e) {
    return reply.code(400).send({ error: String((e as Error).message ?? e) });
  }
});

/** 骑行改名（仅本人骑行；公开演示数据不可改名） */
app.patch('/api/rides/:rideId', async (req, reply) => {
  const uid = authUser(req);
  if (!uid) return reply.code(401).send({ error: '未登录' });
  const rideId = Number((req.params as { rideId: string }).rideId);
  const row = getRideRow(rideId, uid);
  if (!row) return reply.code(404).send({ error: '骑行不存在' });
  if (row.ownerId === null) return reply.code(403).send({ error: '公开演示数据不支持改名' });
  const { title } = (req.body ?? {}) as { title?: string };
  const clean = title?.trim().slice(0, 60);
  if (!clean) return reply.code(400).send({ error: '名称不能为空' });
  updateRideTitle(rideId, clean);
  return { ok: true, title: clean };
});

/** 删除骑行（本人骑行；公开演示数据任何登录用户可删除） */
app.delete('/api/rides/:rideId', async (req, reply) => {
  const uid = authUser(req);
  if (!uid) return reply.code(401).send({ error: '未登录' });
  const rideId = Number((req.params as { rideId: string }).rideId);
  const row = getRideRow(rideId, uid);
  if (!row) return reply.code(404).send({ error: '骑行不存在' });
  deleteRide(rideId);
  return { ok: true };
});

/* ---------- 认证：注册 / 登录 / 登出 / 当前用户 ---------- */

app.post('/api/auth/register', async (req, reply) => {
  const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
  if (!username || username.length < 2 || username.length > 32) {
    return reply.code(400).send({ error: '用户名需 2-32 个字符' });
  }
  if (!password || password.length < 6) {
    return reply.code(400).send({ error: '密码至少 6 位' });
  }
  if (getUserByUsername(username)) {
    return reply.code(409).send({ error: '用户名已被占用' });
  }
  const firstUser = countUsers() === 0;
  const userId = newUserId();
  createUser(userId, username, hashPassword(password));
  // 首个注册用户认领存量骑行数据（此前服务是单用户形态）
  if (firstUser) claimOrphanRides(userId);
  const token = newToken();
  setSession(token, userId);
  return { ok: true, token, username, firstUser };
});

app.post('/api/auth/login', async (req, reply) => {
  const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
  const user = username ? getUserByUsername(username) : undefined;
  if (!user || !password || !verifyPassword(password, user.pass_hash)) {
    return reply.code(401).send({ error: '用户名或密码错误' });
  }
  const token = newToken();
  setSession(token, user.user_id);
  return { ok: true, token, username: user.username };
});

app.post('/api/auth/logout', async (req, reply) => {
  const h = req.headers.authorization ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (token) delSession(token);
  return { ok: true };
});

app.get('/api/auth/me', async (req, reply) => {
  const uid = authUser(req);
  if (!uid) return reply.code(401).send({ error: '未登录' });
  const user = getUserById(uid);
  return { ok: true, username: user?.username ?? uid };
});

app.listen({ port: PORT, host: '127.0.0.1' }).then(() => {
  console.log(`猫踪 CatTrail server: http://127.0.0.1:${PORT} (data dir: ${DATA_DIR})`);
});
