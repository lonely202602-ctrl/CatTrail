/** 存储层骨架：SQLite（node:sqlite，零依赖）。v0 只存一张活动表。 */
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import type { RideRecord } from '@lonelycat/shared';

let db: DatabaseSync | null = null;

export function openDb(file?: string): DatabaseSync {
  if (db) return db;
  const p = file ?? path.resolve(import.meta.dirname, '../../../../.cache/lonelycat.db');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  db = new DatabaseSync(p);
  db.exec(`
    CREATE TABLE IF NOT EXISTS activities (
      ride_id     INTEGER PRIMARY KEY,
      title       TEXT,
      start_time  TEXT,
      distance_m  REAL,
      moving_sec  INTEGER,
      ascent_m    REAL,
      avg_speed   REAL,
      device      TEXT,
      fit_url     TEXT,
      record_json TEXT,
      track_json  TEXT,
      updated_at  TEXT DEFAULT (datetime('now'))
    );
  `);
  return db;
}

export function upsertRide(ride: RideRecord): void {
  const d = openDb();
  d.prepare(
    `INSERT INTO activities (ride_id,title,start_time,distance_m,moving_sec,ascent_m,avg_speed,device,fit_url,record_json,track_json,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
     ON CONFLICT(ride_id) DO UPDATE SET
       title=excluded.title, start_time=excluded.start_time, distance_m=excluded.distance_m,
       moving_sec=excluded.moving_sec, ascent_m=excluded.ascent_m, avg_speed=excluded.avg_speed,
       device=excluded.device, fit_url=excluded.fit_url, record_json=excluded.record_json,
       track_json=excluded.track_json, updated_at=datetime('now')`,
  ).run(
    ride.rideId,
    ride.title,
    ride.date,
    ride.distanceKm * 1000,
    ride.movingTimeSec,
    ride.ascentM,
    ride.avgSpeedKmh,
    ride.device,
    ride.fitUrl,
    JSON.stringify(ride),
    JSON.stringify(ride.track),
  );
}

export function getStoredRideIds(): Set<number> {
  const d = openDb();
  return new Set(d.prepare('SELECT ride_id FROM activities').all().map((r) => Number(r.ride_id)));
}

export function listRides(): RideRecord[] {
  const d = openDb();
  return d
    .prepare('SELECT record_json FROM activities ORDER BY start_time DESC')
    .all()
    .map((r) => JSON.parse(r.record_json as string) as RideRecord);
}
