/** 存储层：SQLite（node:sqlite，零依赖）。用户体系 + 按用户隔离的骑行表。 */
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
      series_v    INTEGER DEFAULT 0,
      record_json TEXT,
      track_json  TEXT,
      updated_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS users (
      user_id    TEXT PRIMARY KEY,
      username   TEXT UNIQUE,
      pass_hash  TEXT,
      igp_u      TEXT,
      igp_p      TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  // 旧库迁移：骑行归属用户（NULL = 公开演示数据）
  try {
    db.exec('ALTER TABLE activities ADD COLUMN user_id TEXT');
  } catch {
    /* 列已存在 */
  }
  return db;
}

export function upsertRide(ride: RideRecord, seriesV = 0, userId: string | null = null): void {
  const d = openDb();
  d.prepare(
    `INSERT INTO activities (ride_id,title,start_time,distance_m,moving_sec,ascent_m,avg_speed,device,fit_url,series_v,record_json,track_json,user_id,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
     ON CONFLICT(ride_id) DO UPDATE SET
       title=excluded.title, start_time=excluded.start_time, distance_m=excluded.distance_m,
       moving_sec=excluded.moving_sec, ascent_m=excluded.ascent_m, avg_speed=excluded.avg_speed,
       device=excluded.device, fit_url=excluded.fit_url, series_v=excluded.series_v,
       record_json=excluded.record_json, track_json=excluded.track_json, user_id=excluded.user_id,
       updated_at=datetime('now')`,
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
    seriesV,
    JSON.stringify(ride),
    JSON.stringify(ride.track),
    userId,
  );
}

/** rideId → 已存储的序列版本号（用于增量回填判断；按用户隔离） */
export function getStoredSeriesVersions(userId: string): Map<number, number> {
  const d = openDb();
  return new Map(
    d
      .prepare('SELECT ride_id, series_v FROM activities WHERE user_id = ? OR user_id IS NULL')
      .all(userId)
      .map((r) => [Number(r.ride_id), Number(r.series_v ?? 0)]),
  );
}

/** 用户的骑行列表（含公开演示数据：user_id IS NULL） */
export function listRides(userId: string): RideRecord[] {
  const d = openDb();
  return d
    .prepare('SELECT record_json FROM activities WHERE user_id = ? OR user_id IS NULL ORDER BY start_time DESC')
    .all(userId)
    .map((r) => JSON.parse(r.record_json as string) as RideRecord);
}

/** 公开演示数据（user_id IS NULL，供演示快照管线使用） */
export function listPublicRides(): RideRecord[] {
  const d = openDb();
  return d
    .prepare('SELECT record_json FROM activities WHERE user_id IS NULL ORDER BY start_time DESC')
    .all()
    .map((r) => JSON.parse(r.record_json as string) as RideRecord);
}

/* ---------- 用户体系 ---------- */

export function countUsers(): number {
  const row = openDb().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  return Number(row.n);
}

export function getUserByUsername(username: string) {
  return openDb().prepare('SELECT * FROM users WHERE username = ?').get(username) as
    | { user_id: string; username: string; pass_hash: string; igp_u: string | null; igp_p: string | null }
    | undefined;
}

export function createUser(userId: string, username: string, passHash: string) {
  openDb().prepare('INSERT INTO users (user_id, username, pass_hash) VALUES (?,?,?)').run(userId, username, passHash);
}

export function getUserById(userId: string) {
  return openDb().prepare('SELECT * FROM users WHERE user_id = ?').get(userId) as
    | { user_id: string; username: string; pass_hash: string; igp_u: string | null; igp_p: string | null }
    | undefined;
}

export function setSession(token: string, userId: string) {
  openDb().prepare('INSERT INTO sessions (token, user_id) VALUES (?,?)').run(token, userId);
}

export function getSessionUser(token: string): string | null {
  const row = openDb().prepare('SELECT user_id FROM sessions WHERE token = ?').get(token) as
    | { user_id: string }
    | undefined;
  return row?.user_id ?? null;
}

export function delSession(token: string) {
  openDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/** 首个注册用户认领库里无主的既有骑行（演示数据 9900xx 保持公开） */
export function claimOrphanRides(userId: string) {
  openDb()
    .prepare('UPDATE activities SET user_id = ? WHERE user_id IS NULL AND ride_id NOT BETWEEN 990000000 AND 990000999')
    .run(userId);
}

export function setIgpCreds(userId: string, u: string, p: string) {
  openDb().prepare('UPDATE users SET igp_u = ?, igp_p = ? WHERE user_id = ?').run(u, p, userId);
}

export function clearIgpCreds(userId: string) {
  openDb().prepare('UPDATE users SET igp_u = NULL, igp_p = NULL WHERE user_id = ?').run(userId);
}
