/** 数据适配器：服务端模式（/api）与静态演示模式（/data 快照）共用一套契约 */
import type { ClustersIndex, RidesIndex } from '@lonelycat/shared';

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
