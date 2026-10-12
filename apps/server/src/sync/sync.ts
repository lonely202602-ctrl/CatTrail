/** 同步编排：登录 → 列表 → 增量详情 → FIT → 轨迹+逐秒序列 → 入库 + 落盘静态快照 */
import fs from 'node:fs';
import path from 'node:path';
import type { RideSeriesPoint, RideRecord, RidesIndex, RideInfo } from '@lonelycat/shared';
import { getEdgeKeys, login, listAllActivities, getActivityDetail, downloadFit, sleep } from '../igpsport/client.js';
import { parseFit, type TrackPoint, type FitMeta } from '../igpsport/fit.js';
import { openDb, upsertRide, getStoredSeriesVersions, listRides } from '../store/db.js';
import { buildClusters } from '../clusters/cluster.js';
import { resolveRegion } from '../geo/region.js';

/** 序列数据结构版本：结构变更时 +1，旧记录自动回填重拉 */
const SERIES_V = 3;

export interface SyncOptions {
  username: string;
  password: string;
  /** 归属用户（多用户数据隔离） */
  userId: string;
  /** 每次接口调用的间隔 ms（礼貌限频） */
  intervalMs?: number;
}

export interface SyncSummary {
  fetched: number;
  added: number;
  skipped: number;
  totalKm: number;
  /** 单条活动同步失败（如 FIT 链接失效）不中断整体，逐条记录在这里 */
  failures: RideSyncFailure[];
}

export interface RideSyncFailure {
  rideId: number;
  title: string;
  reason: string;
}

function haversine(a: [number, number], b: [number, number]): number {
  const [lat1, lon1, lat2, lon2] = [a[1], a[0], b[1], b[0]].map((v) => (v * Math.PI) / 180);
  const h =
    Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/** FIT 采样点 → 逐秒序列（t 相对起始秒；无时间戳时按 1s 采样兜底） */
function buildSeries(points: TrackPoint[]): RideSeriesPoint[] {
  const first = points.find((p) => p.time)?.time;
  const t0 = first ? Date.parse(first) : null;
  return points.map((p, i) => ({
    t: t0 != null && p.time ? Math.round((Date.parse(p.time) - t0) / 1000) : i,
    s: p.spd != null ? Math.round(p.spd * 10) / 10 : undefined,
    a: p.alt != null ? Math.round(p.alt * 10) / 10 : undefined,
    h: p.hr ?? undefined,
  }));
}

export async function runSync(opts: SyncOptions): Promise<SyncSummary> {
  const { username, password, userId, intervalMs = 1100 } = opts;
  openDb();

  const keys = await getEdgeKeys();
  const session = await login(keys, username, password);
  const rows = await listAllActivities(keys, session.access_token);

  const versions = getStoredSeriesVersions(userId);
  let added = 0;
  let skipped = 0;
  const failures: RideSyncFailure[] = [];

  for (const row of rows) {
    if (versions.get(row.rideId) === SERIES_V) {
      skipped++;
      continue;
    }
    try {
      await sleep(intervalMs);
      const detail = await getActivityDetail(keys, session.access_token, row.rideId);
      await sleep(intervalMs);
      const fitBuf = await downloadFit(detail.fitUrl);
      const { points } = await parseFit(fitBuf);
      const track = points.map((p) => [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))] as [number, number]);

      // 起点 → 省/市（DataV 边界离线判定，本地缓存）
      const start = track[0];
      const region = start ? await resolveRegion(start[0], start[1]) : { province: '', city: '' };
      if (region.province) {
        console.log(`    ↳ ${region.province}${region.city ? ' · ' + region.city : ''}`);
      }

      const record: RideRecord = {
        rideId: row.rideId,
        title: row.title,
        date: (detail.startTime ?? row.startTime).replace(/\./g, '-').slice(0, 19),
        distanceKm: Math.round((row.rideDistance / 1000) * 100) / 100,
        movingTimeSec: row.totalMovingTime,
        ascentM: row.totalAscent,
        avgSpeedKmh: Math.round((row.avgSpeed ?? 0) * 3.6 * 10) / 10,
        device: row.productName ?? 'iGPSPORT',
        fitUrl: detail.fitUrl,
        track,
        series: buildSeries(points),
        calorie: detail.calorie,
        maxSpeedKmh: Math.round(Number(detail.maxSpeed ?? 0) * 3.6 * 10) / 10,
        province: region.province,
        city: region.city,
      };
      upsertRide(record, SERIES_V, userId);
      added++;
      console.log(`  + ${record.date} ${record.title}: ${record.distanceKm}km / ${track.length} 点 / ${record.series?.length ?? 0} 序列点`);
    } catch (e) {
      const reason = String((e as Error).message ?? e).slice(0, 400);
      failures.push({ rideId: row.rideId, title: row.title, reason });
      console.warn(`  ! 跳过 ${row.title}(#${row.rideId})：${reason}`);
    }
  }

  const totalKm = Math.round(
    listRides(userId).reduce((sum, r) => sum + r.distanceKm, 0) * 100,
  ) / 100;
  return { fetched: rows.length, added, skipped, totalKm, failures };
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function writeRideSnapshot(dataDir: string, ride: RideRecord) {
  ensureDir(path.join(dataDir, 'rides'));
  const gj = {
    type: 'Feature',
    properties: {
      rideId: ride.rideId,
      title: ride.title,
      date: ride.date,
      distance_km: ride.distanceKm,
      ascent_m: ride.ascentM,
      avg_speed_kmh: ride.avgSpeedKmh,
      device: ride.device,
    },
    geometry: { type: 'LineString', coordinates: ride.track },
  };
  fs.writeFileSync(path.join(dataDir, 'rides', `${ride.rideId}.geojson`), JSON.stringify(gj));
}

/** 逐秒序列快照（data/series/{rideId}.json，轨迹分析抽屉按需加载） */
export function writeSeriesSnapshot(dataDir: string, ride: RideRecord) {
  ensureDir(path.join(dataDir, 'series'));
  fs.writeFileSync(
    path.join(dataDir, 'series', `${ride.rideId}.json`),
    JSON.stringify({ rideId: ride.rideId, series: ride.series ?? [] }),
  );
}

function toInfo(r: RideRecord): RideInfo {
  return {
    rideId: r.rideId,
    title: r.title,
    date: r.date,
    distanceKm: r.distanceKm,
    movingTimeSec: r.movingTimeSec,
    ascentM: r.ascentM,
    avgSpeedKmh: r.avgSpeedKmh,
    device: r.device,
    calorie: r.calorie,
    maxSpeedKmh: r.maxSpeedKmh,
    province: r.province,
    city: r.city,
    demo: r.demo,
  };
}

export function writeIndexSnapshot(dataDir: string, rides: RideRecord[]) {
  ensureDir(dataDir);
  const infos = rides.map(toInfo).sort((a, b) => (a.date < b.date ? 1 : -1));
  const index: RidesIndex = {
    generatedAt: new Date().toISOString(),
    totalKm: Math.round(infos.reduce((s, r) => s + r.distanceKm, 0) * 100) / 100,
    totalAscentM: infos.reduce((s, r) => s + r.ascentM, 0),
    rides: infos,
  };
  fs.writeFileSync(path.join(dataDir, 'index.json'), JSON.stringify(index, null, 2));

  const fc = {
    type: 'FeatureCollection',
    features: rides.map((r) => ({
      type: 'Feature',
      properties: toInfo(r),
      geometry: { type: 'LineString', coordinates: r.track },
    })),
  };
  fs.writeFileSync(path.join(dataDir, 'tracks.json'), JSON.stringify(fc));
}

/** 猫径聚类快照（data/clusters.json） */
export function writeClustersSnapshot(dataDir: string, rides: RideRecord[]) {
  ensureDir(dataDir);
  fs.writeFileSync(path.join(dataDir, 'clusters.json'), JSON.stringify(buildClusters(rides), null, 2));
}

export interface IngestSummary {
  rideId: number;
  date: string;
  distanceKm: number;
  movingTimeSec: number;
  /** 同一骑行时间已存在 = 覆盖更新 */
  replaced: boolean;
}

/** FIT 手动上传入库：解析 → 建记录（rideId 取起点时间，重传即覆盖）→ 快照刷新 */
export async function ingestFitRide(buf: Buffer, userId: string): Promise<IngestSummary> {
  openDb();
  // 非法文件提前拦截：FIT 文件头 bytes 4-7 固定 ".FIT"
  if (buf.length < 12 || buf.toString('latin1', 4, 8) !== '.FIT') {
    throw new Error('这不是有效的 FIT 文件，请从码表 App 导出 .fit 后再拖入');
  }
  let points: TrackPoint[];
  let meta: FitMeta;
  try {
    ({ points, meta } = await parseFit(buf));
  } catch (e) {
    throw new Error(`FIT 文件解析失败（文件可能已损坏）：${String((e as Error).message ?? e).slice(0, 120)}`);
  }
  if (points.length < 2) throw new Error('FIT 内没有可用轨迹点');

  const firstTime = points.find((p) => p.time)?.time ?? meta.startTime;
  if (!firstTime) throw new Error('FIT 缺少时间戳，无法定位骑行时间');
  const t0 = Date.parse(firstTime);
  if (!Number.isFinite(t0)) throw new Error('FIT 时间戳无法解析');

  const lastTime = [...points].reverse().find((p) => p.time)?.time;
  const movingTimeSec = lastTime ? Math.max(0, Math.round((Date.parse(lastTime) - t0) / 1000)) : 0;
  const distanceM = meta.totalDistanceM ?? 0;
  if (distanceM < 100) throw new Error('FIT 累计距离过短（<100m），疑似无效骑行文件');

  const track = points.map((p) => [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))] as [number, number]);

  // 爬升：海拔正增量累加（0.5m 噪声门槛滤漂移）
  let ascentRaw = 0;
  for (let i = 1; i < points.length; i++) {
    const d = (points[i].alt ?? 0) - (points[i - 1].alt ?? 0);
    if (d > 0.5) ascentRaw += d;
  }

  // 起点时间转东八区显示时间；rideId = 起点时间数字（同一次骑行重传即覆盖）
  const cnDate = new Date(t0 + 8 * 3600e3).toISOString();
  const date = cnDate.slice(0, 19).replace('T', ' ');
  const rideId = Number(date.replace(/[-: ]/g, '').slice(0, 14));
  const distanceKm = Math.round((distanceM / 1000) * 100) / 100;
  const avgSpeedKmh = movingTimeSec > 0 ? Math.round((distanceKm / (movingTimeSec / 3600)) * 10) / 10 : 0;

  const region = await resolveRegion(track[0][0], track[0][1]);

  const record: RideRecord = {
    rideId,
    title: '户外骑行',
    date,
    distanceKm,
    movingTimeSec,
    ascentM: Math.round(ascentRaw),
    avgSpeedKmh,
    device: 'FIT 导入',
    fitUrl: '',
    track,
    series: buildSeries(points),
    maxSpeedKmh: meta.maxSpeedKmh != null ? Math.round(meta.maxSpeedKmh * 10) / 10 : undefined,
    calorie: meta.calories,
    province: region.province,
    city: region.city,
  };

  const replaced = listRides(userId).some((r) => r.rideId === rideId);
  upsertRide(record, SERIES_V, userId);
  console.log(`  + [FIT导入] ${record.date}: ${record.distanceKm}km / ${track.length} 点${replaced ? '（覆盖）' : ''}`);
  return { rideId, date, distanceKm, movingTimeSec, replaced };
}
