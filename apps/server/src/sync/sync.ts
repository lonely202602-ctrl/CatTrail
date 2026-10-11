/** 同步编排：登录 → 列表 → 增量详情 → FIT → 轨迹 → 入库 + 落盘静态快照 */
import fs from 'node:fs';
import path from 'node:path';
import type { RidesIndex, RideInfo, RideRecord } from '@lonelycat/shared';
import { getEdgeKeys, login, listAllActivities, getActivityDetail, downloadFit, sleep } from '../igpsport/client.js';
import { parseFit } from '../igpsport/fit.js';
import { openDb, upsertRide, getStoredRideIds, listRides } from '../store/db.js';

export interface SyncOptions {
  username: string;
  password: string;
  /** 静态快照输出目录（仓库 data/，供纯静态演示模式使用） */
  dataDir: string;
  /** 每次接口调用的间隔 ms（礼貌限频） */
  intervalMs?: number;
}

export interface SyncSummary {
  fetched: number;
  added: number;
  skipped: number;
  totalKm: number;
}

function haversine(a: [number, number], b: [number, number]): number {
  const [lat1, lon1, lat2, lon2] = [a[1], a[0], b[1], b[0]].map((v) => (v * Math.PI) / 180);
  const h =
    Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

export async function runSync(opts: SyncOptions): Promise<SyncSummary> {
  const { username, password, dataDir, intervalMs = 1100 } = opts;
  openDb();

  const keys = await getEdgeKeys();
  const session = await login(keys, username, password);
  const rows = await listAllActivities(keys, session.access_token);

  const known = getStoredRideIds();
  let added = 0;
  let skipped = 0;

  for (const row of rows) {
    if (known.has(row.rideId)) {
      skipped++;
      continue;
    }
    await sleep(intervalMs);
    const detail = await getActivityDetail(keys, session.access_token, row.rideId);
    await sleep(intervalMs);
    const fitBuf = await downloadFit(detail.fitUrl);
    const points = await parseFit(fitBuf);
    const track = points.map((p) => [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))] as [number, number]);

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
    };
    upsertRide(record);
    writeRideSnapshot(dataDir, record);
    added++;
    console.log(`  + ${record.date} ${record.title}: ${record.distanceKm}km / ${track.length} 点`);
  }

  // 重写聚合快照
  const rides = listRides();
  writeIndexSnapshot(dataDir, rides);
  const totalKm = Math.round(rides.reduce((s, r) => s + r.distanceKm, 0) * 100) / 100;
  return { fetched: rows.length, added, skipped, totalKm };
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
