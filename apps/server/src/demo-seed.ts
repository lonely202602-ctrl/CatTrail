/** 示例数据种子：生成外地城市的合成骑行（演示全国视图/定位/多主题效果） */
import path from 'node:path';
import type { RideRecord, RideSeriesPoint } from '@lonelycat/shared';
import { openDb, upsertRide, listRides } from './store/db.js';
import { writeIndexSnapshot, writeClustersSnapshot, writeSeriesSnapshot } from './sync/sync.js';
import { resolveRegion } from './geo/region.js';

interface DemoSpec {
  rideId: number;
  title: string;
  date: string;
  center: [number, number]; // [lng, lat]
  radiusKm: number;
  points: number;
  device: string;
}

const DEMOS: DemoSpec[] = [
  { rideId: 990000001, title: '北京 · 长安街夜骑', date: '2026-10-03 19:32:00', center: [116.397, 39.906], radiusKm: 5.2, points: 420, device: 'DEMO' },
  { rideId: 990000002, title: '上海 · 浦江滨江线', date: '2026-10-08 07:05:00', center: [121.497, 31.235], radiusKm: 4.1, points: 360, device: 'DEMO' },
];

function genLoop(spec: DemoSpec) {
  const track: [number, number][] = [];
  const series: RideSeriesPoint[] = [];
  const rLat = spec.radiusKm / 111;
  const rLng = spec.radiusKm / (111 * Math.cos((spec.center[1] * Math.PI) / 180));
  for (let i = 0; i < spec.points; i++) {
    const th = (i / spec.points) * Math.PI * 2;
    const wob = 1 + 0.14 * Math.sin(th * 3) + 0.06 * Math.sin(th * 7 + 1);
    const lng = spec.center[0] + rLng * wob * Math.cos(th);
    const lat = spec.center[1] + rLat * wob * Math.sin(th);
    track.push([Number(lng.toFixed(6)), Number(lat.toFixed(6))]);
    const t = i;
    const s = Math.round((19 + 7 * Math.sin(th * 4) + (Math.random() - 0.5) * 3) * 10) / 10;
    const a = Math.round((12 + 9 * Math.sin(th * 2 + 0.5) + (Math.random() - 0.5) * 2) * 10) / 10;
    series.push({ t, s: Math.max(4, s), a });
  }
  return { track, series };
}

async function main() {
  openDb();
  const dataDir = path.resolve(import.meta.dirname, process.env.DATA_DIR ?? '../../../data');
  for (const spec of DEMOS) {
    const { track, series } = genLoop(spec);
    let dist = 0;
    for (let i = 1; i < track.length; i++) {
      const [lng1, lat1] = track[i - 1];
      const [lng2, lat2] = track[i];
      dist +=
        2 *
        6371000 *
        Math.asin(
          Math.sqrt(
            Math.sin(((lat2 - lat1) * Math.PI) / 360) ** 2 +
              Math.cos((lat1 * Math.PI) / 180) *
                Math.cos((lat2 * Math.PI) / 180) *
                Math.sin(((lng2 - lng1) * Math.PI) / 360) ** 2,
          ),
        );
    }
    const region = await resolveRegion(track[0][0], track[0][1]);
    const speeds = series.map((s) => s.s ?? 0);
    const ride: RideRecord = {
      rideId: spec.rideId,
      title: spec.title,
      date: spec.date,
      distanceKm: Math.round((dist / 1000) * 100) / 100,
      movingTimeSec: spec.points,
      ascentM: 30 + Math.round(Math.random() * 60),
      avgSpeedKmh: Math.round((spec.radiusKm * 2 * Math.PI) / (spec.points / 3600) / 10) * 10 / 10,
      device: spec.device,
      fitUrl: '',
      track,
      series,
      calorie: Math.round((dist / 1000) * 21),
      maxSpeedKmh: Math.max(...speeds),
      province: region.province,
      city: region.city,
    };
    upsertRide(ride, 3);
    writeSeriesSnapshot(dataDir, ride);
    console.log(`+ ${spec.title}: ${ride.distanceKm}km @ ${region.province} ${region.city}`);
  }
  const rides = listRides();
  writeIndexSnapshot(dataDir, rides);
  writeClustersSnapshot(dataDir, rides);
  console.log(`示例数据完成，当前总计 ${rides.length} 条骑行`);
}

main();
