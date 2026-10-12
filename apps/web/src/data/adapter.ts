/** 数据适配器：服务端模式（/api）与静态演示模式（/data 快照）共用一套契约 */
import type { ClustersIndex, RideSeriesPoint, RidesIndex } from '@lonelycat/shared';

export const DATA_MODE = (import.meta.env.VITE_DATA_MODE as 'server' | 'static' | undefined) ?? 'server';

export async function fetchRidesIndex(): Promise<RidesIndex> {
  const url = DATA_MODE === 'static' ? '/index.json' : '/api/activities';
  const r = await fetch(url);
  if (!r.ok) throw new Error(`加载骑行列表失败 (${r.status})`);
  return r.json();
}

export async function fetchClusters(): Promise<ClustersIndex> {
  const url = DATA_MODE === 'static' ? '/clusters.json' : '/api/clusters';
  const r = await fetch(url);
  if (!r.ok) throw new Error(`加载猫径失败 (${r.status})`);
  return r.json();
}

export async function fetchSeries(rideId: number): Promise<RideSeriesPoint[]> {
  const url = DATA_MODE === 'static' ? `/series/${rideId}.json` : `/api/series/${rideId}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`加载序列失败 (${r.status})`);
  const d = (await r.json()) as { rideId: number; series: RideSeriesPoint[] };
  return d.series ?? [];
}

export interface TrackFC {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: {
      rideId: number;
      title: string;
      date: string;
      distanceKm: number;
      ascentM: number;
      avgSpeedKmh: number;
      device: string;
    };
    geometry: { type: 'LineString'; coordinates: [number, number][] };
  }>;
}

export async function fetchTracks(): Promise<TrackFC> {
  const url = DATA_MODE === 'static' ? '/tracks.json' : '/api/tracks';
  const r = await fetch(url);
  if (!r.ok) throw new Error(`加载轨迹失败 (${r.status})`);
  return r.json();
}

/* ---------- 设置页 / 手动导入（仅自有后端模式可用） ---------- */

function requireServer() {
  if (DATA_MODE === 'static') throw new Error('静态演示模式不支持该功能，请使用自有后端部署');
}

export interface IgpsportSettings {
  bound: boolean;
  source: 'stored' | 'env' | 'none';
  /** 脱敏用户名（a***@qq.com） */
  username: string | null;
}

export async function fetchIgpsportSettings(): Promise<IgpsportSettings> {
  requireServer();
  const r = await fetch('/api/settings/igpsport');
  if (!r.ok) throw new Error(`读取绑定状态失败 (${r.status})`);
  return r.json();
}

export async function saveIgpsportSettings(username: string, password: string): Promise<IgpsportSettings> {
  requireServer();
  const r = await fetch('/api/settings/igpsport', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? `绑定失败 (${r.status})`);
  return d as IgpsportSettings;
}

export async function clearIgpsportSettings(): Promise<void> {
  requireServer();
  const r = await fetch('/api/settings/igpsport', { method: 'DELETE' });
  if (!r.ok) throw new Error(`解绑失败 (${r.status})`);
}

export interface SyncResult {
  fetched: number;
  added: number;
  skipped: number;
  totalKm: number;
}

export async function triggerSync(): Promise<SyncResult> {
  requireServer();
  const r = await fetch('/api/sync', { method: 'POST' });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? `同步失败 (${r.status})`);
  return d as SyncResult;
}

export interface FitUploadResult {
  ok: true;
  rideId: number;
  date: string;
  distanceKm: number;
  movingTimeSec: number;
  replaced: boolean;
}

export async function uploadFit(file: File): Promise<FitUploadResult> {
  requireServer();
  const r = await fetch('/api/activities/fit', {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: file,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? `上传失败 (${r.status})`);
  return d as FitUploadResult;
}
