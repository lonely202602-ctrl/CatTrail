/** LonelyCat 服务端：数据 API（服务端模式）+ 静态快照（演示模式）+ 同步触发 */
import Fastify from 'fastify';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, listRides } from './store/db.js';
import { writeIndexSnapshot } from './sync/sync.js';
import { buildClusters } from './clusters/cluster.js';
import { fetchUpstream, rewriteTileJSON, originOf } from './tiles/proxy.js';
import { readCreds, writeCreds, clearCreds, maskUsername } from './store/credentials.js';
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

function ridesOrSeed(): RideRecord[] {
  const rides = listRides();
  if (rides.length > 0) return rides;
  // 数据库为空时回退到静态快照（首次部署/演示模式）
  const raw = readStaticData('index.json');
  if (!raw) return [];
  const index = JSON.parse(raw) as RidesIndex;
  return index.rides.map((info) => {
    const fc = JSON.parse(readStaticData(`rides/${info.rideId}.geojson`) ?? '{}');
    return { ...info, fitUrl: '', track: fc.geometry?.coordinates ?? [] } as RideRecord;
  });
}

app.get('/api/health', async () => ({ ok: true, ts: Date.now() }));

/** 骑行列表（与 data/index.json 同构） */
app.get('/api/activities', async () => {
  const rides = ridesOrSeed();
  const index: RidesIndex = {
    generatedAt: new Date().toISOString(),
    totalKm: Math.round(rides.reduce((s, r) => s + r.distanceKm, 0) * 100) / 100,
    totalAscentM: rides.reduce((s, r) => s + r.ascentM, 0),
    rides: rides.map(({ fitUrl: _f, track: _t, ...info }) => info),
  };
  return index;
});

/** 全部轨迹 FeatureCollection（与 data/tracks.json 同构） */
app.get('/api/tracks', async () => {
  const rides = ridesOrSeed();
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

/** 猫径：相似线路聚类（实时计算，与 data/clusters.json 同构） */
app.get('/api/clusters', async () => buildClusters(ridesOrSeed()));

/** 逐秒序列（轨迹分析抽屉用；数据库优先，回退静态快照） */
app.get('/api/series/:rideId', async (req, reply) => {
  const rideId = Number((req.params as { rideId: string }).rideId);
  if (!Number.isFinite(rideId)) return reply.code(400).send({ error: 'bad rideId' });
  const ride = listRides().find((r) => r.rideId === rideId);
  if (ride?.series) return { rideId, series: ride.series };
  const raw = readStaticData(`series/${rideId}.json`);
  if (raw) {
    reply.header('content-type', 'application/json; charset=utf-8');
    return raw;
  }
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

/** 触发同步（凭据优先用页面绑定的账号，回退服务端环境变量） */
app.post('/api/sync', async (req, reply) => {
  const token = process.env.SYNC_TOKEN;
  if (token && req.headers['x-sync-token'] !== token) {
    return reply.code(401).send({ error: 'unauthorized' });
  }
  const stored = readCreds();
  const username = stored?.username ?? process.env.IGPSPORT_USERNAME;
  const password = stored?.password ?? process.env.IGPSPORT_PASSWORD;
  if (!username || !password) return reply.code(400).send({ error: '未绑定 iGPSPORT 账号，请先在设置页绑定' });
  try {
    const { runSync } = await import('./sync/sync.js');
    const summary = await runSync({ username, password, dataDir: DATA_DIR });
    return { ok: true, ...summary };
  } catch (e) {
    return reply.code(502).send({ error: String((e as Error).message ?? e) });
  }
});

/** iGPSPORT 账号绑定状态（密码永不回传，只回脱敏用户名） */
app.get('/api/settings/igpsport', async () => {
  const stored = readCreds();
  if (stored) return { bound: true, source: 'stored', username: maskUsername(stored.username) };
  if (process.env.IGPSPORT_USERNAME) {
    return { bound: true, source: 'env', username: maskUsername(process.env.IGPSPORT_USERNAME) };
  }
  return { bound: false, source: 'none', username: null };
});

/** 绑定/换绑：凭据写入自部署服务器本地（.cache/igpsport-auth.json，不入仓库） */
app.post('/api/settings/igpsport', async (req, reply) => {
  const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
  if (!username || !password) return reply.code(400).send({ error: '需要 username 与 password' });
  writeCreds(username, password);
  return { ok: true, source: 'stored', username: maskUsername(username) };
});

/** 解绑 */
app.delete('/api/settings/igpsport', async () => {
  clearCreds();
  return { ok: true };
});

/** FIT 手动上传：解析 → 入库 → 快照刷新（rideId 取起点时间，同一次骑行重传即覆盖） */
app.post('/api/activities/fit', async (req, reply) => {
  const buf = req.body as Buffer;
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return reply.code(400).send({ error: '需要二进制 FIT 文件体（application/octet-stream）' });
  }
  try {
    const { ingestFitRide } = await import('./sync/sync.js');
    const summary = await ingestFitRide(buf, DATA_DIR);
    return { ok: true, ...summary };
  } catch (e) {
    return reply.code(400).send({ error: String((e as Error).message ?? e) });
  }
});

app.listen({ port: PORT, host: '127.0.0.1' }).then(() => {
  console.log(`猫踪 CatTrail server: http://127.0.0.1:${PORT} (data dir: ${DATA_DIR})`);
});
