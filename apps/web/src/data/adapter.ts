/** 数据适配器：服务端模式（/api，登录+令牌）与静态演示模式（/data 快照）共用一套契约 */
import type { ClustersIndex, RideSeriesPoint, RidesIndex } from '@lonelycat/shared';

export const DATA_MODE = (import.meta.env.VITE_DATA_MODE as 'server' | 'static' | undefined) ?? 'server';

const TOKEN_KEY = 'cattrail-token';
export function getToken(): string | null {
  return DATA_MODE === 'static' ? null : localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(new Event('cattrail-unauthorized'));
}

/** 带令牌的 API 请求；401 统一视为登录过期 */
export async function api<T>(url: string, opts: RequestInit = {}): Promise<T> {
  const headers = new Headers(opts.headers);
  const token = getToken();
  if (token) headers.set('authorization', `Bearer ${token}`);
  const r = await fetch(url, { ...opts, headers });
  if (r.status === 401 && !url.startsWith('/api/auth/')) {
    clearToken();
    throw new Error('登录已过期，请重新登录');
  }
  if (!r.ok) {
    const d = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(d.error ?? `请求失败 (${r.status})`);
  }
  return r.json() as Promise<T>;
}

/* ---------- 认证 ---------- */

export async function registerUser(username: string, password: string): Promise<{ token: string; username: string }> {
  const r = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? `注册失败 (${r.status})`);
  setToken(d.token);
  return d;
}

export async function loginUser(username: string, password: string): Promise<{ token: string; username: string }> {
  const r = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? `登录失败 (${r.status})`);
  setToken(d.token);
  return d;
}

export async function logoutUser(): Promise<void> {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } finally {
    clearToken();
  }
}

export async function fetchMe(): Promise<{ username: string }> {
  return api('/api/auth/me');
}

export async function fetchRidesIndex(): Promise<RidesIndex> {
  if (DATA_MODE === 'static') {
    const r = await fetch('/index.json');
    if (!r.ok) throw new Error(`加载骑行列表失败 (${r.status})`);
    return r.json();
  }
  return api('/api/activities');
}

export async function fetchClusters(): Promise<ClustersIndex> {
  if (DATA_MODE === 'static') {
    const r = await fetch('/clusters.json');
    if (!r.ok) throw new Error(`加载猫径失败 (${r.status})`);
    return r.json();
  }
  return api('/api/clusters');
}

export async function fetchSeries(rideId: number): Promise<RideSeriesPoint[]> {
  if (DATA_MODE === 'static') {
    const r = await fetch(`/series/${rideId}.json`);
    if (!r.ok) throw new Error(`加载序列失败 (${r.status})`);
    const d = (await r.json()) as { rideId: number; series: RideSeriesPoint[] };
    return d.series ?? [];
  }
  const d = await api<{ rideId: number; series: RideSeriesPoint[] }>(`/api/series/${rideId}`);
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
  if (DATA_MODE === 'static') {
    const r = await fetch('/tracks.json');
    if (!r.ok) throw new Error(`加载轨迹失败 (${r.status})`);
    return r.json();
  }
  return api('/api/tracks');
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
  return api('/api/settings/igpsport');
}

export async function saveIgpsportSettings(username: string, password: string): Promise<IgpsportSettings> {
  requireServer();
  return api('/api/settings/igpsport', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

export async function clearIgpsportSettings(): Promise<void> {
  requireServer();
  await api('/api/settings/igpsport', { method: 'DELETE' });
}

export interface SyncResult {
  fetched: number;
  added: number;
  skipped: number;
  totalKm: number;
}

export async function triggerSync(): Promise<SyncResult> {
  requireServer();
  return api('/api/sync', { method: 'POST' });
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
  return api('/api/activities/fit', {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: file,
  });
}
