/**
 * 相似线路聚类（猫径）：把"反复骑的同一条路"找出来。
 * 算法：起终点接近 + 里程相近 预筛 → 离散 Fréchet 距离（含反向）判定 → 并查集聚类。
 * 纯本地计算，不依赖任何在线服务。
 */
import type { RideRecord, RouteCluster, ClustersIndex } from '@lonelycat/shared';

type Pt = [number, number]; // [lng, lat]

const EARTH_R = 6371000;

export function haversine(a: Pt, b: Pt): number {
  const [lat1, lon1, lat2, lon2] = [a[1], a[0], b[1], b[0]].map((v) => (v * Math.PI) / 180);
  const h =
    Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

/** 按里程均匀重采样为 n 个点（降低 Fréchet 计算量、消除采样率差异） */
function resample(track: Pt[], n = 80): Pt[] {
  if (track.length <= n) return track;
  const cum: number[] = [0];
  for (let i = 1; i < track.length; i++) cum.push(cum[i - 1] + haversine(track[i - 1], track[i]));
  const total = cum[cum.length - 1];
  if (total === 0) return [track[0]];
  const out: Pt[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    while (j < cum.length - 2 && cum[j + 1] < target) j++;
    out.push(track[j]);
  }
  out[n - 1] = track[track.length - 1];
  return out;
}

/** 离散 Fréchet 距离（米）：衡量两条有序折线的相似程度 */
function discreteFrechet(a: Pt[], b: Pt[]): number {
  const n = a.length;
  const m = b.length;
  const ca: number[][] = Array.from({ length: n }, () => new Array<number>(m).fill(-1));
  const dist = (p: Pt, q: Pt) => Math.hypot((p[0] - q[0]) * Math.cos((((p[1] + q[1]) / 2) * Math.PI) / 180), p[1] - q[1]) * 111320;

  const rec = (i: number, j: number): number => {
    if (ca[i][j] > -1) return ca[i][j];
    const d = dist(a[i], b[j]);
    if (i === 0 && j === 0) return (ca[i][j] = d);
    if (i === 0) return (ca[i][j] = Math.max(rec(0, j - 1), d));
    if (j === 0) return (ca[i][j] = Math.max(rec(i - 1, 0), d));
    return (ca[i][j] = Math.max(Math.min(rec(i - 1, j), rec(i - 1, j - 1), rec(i, j - 1)), d));
  };
  return rec(n - 1, m - 1);
}

class UnionFind {
  private parent = new Map<number, number>();
  find(x: number): number {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    while (this.parent.get(x) !== root) {
      const next = this.parent.get(x)!;
      this.parent.set(x, root);
      x = next;
    }
    return root;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

const trackLength = (t: Pt[]) => {
  let s = 0;
  for (let i = 1; i < t.length; i++) s += haversine(t[i - 1], t[i]);
  return s;
};

/**
 * 从全部骑行记录构建聚类。只输出 count ≥ 2 的"猫径"。
 */
export function buildClusters(rides: RideRecord[]): ClustersIndex {
  const items = rides
    .filter((r) => r.track && r.track.length >= 10)
    .map((r) => ({ ride: r, simple: resample(r.track, 80), len: trackLength(r.track) }));

  const uf = new UnionFind();
  const THRESHOLD_ABS = 250; // 米
  const THRESHOLD_RATIO = 0.12;

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const A = items[i];
      const B = items[j];
      // 预筛：起、终点都接近，且总里程相近（往返反向的环线起终点也重合）
      const startGap = haversine(A.simple[0], B.simple[0]);
      const endGap = haversine(A.simple[A.simple.length - 1], B.simple[B.simple.length - 1]);
      const lenRatio = Math.max(A.len, B.len) / Math.max(1, Math.min(A.len, B.len));
      if (startGap > 600 || endGap > 600 || lenRatio > 1.25) continue;

      const threshold = Math.max(THRESHOLD_ABS, THRESHOLD_RATIO * Math.min(A.len, B.len));
      const fwd = discreteFrechet(A.simple, B.simple);
      const rev = discreteFrechet(A.simple, [...B.simple].reverse());
      if (Math.min(fwd, rev) <= threshold) uf.union(A.ride.rideId, B.ride.rideId);
    }
  }

  const groups = new Map<number, RideRecord[]>();
  for (const it of items) {
    const root = uf.find(it.ride.rideId);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(it.ride);
  }

  const clusters: RouteCluster[] = [];
  let seq = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => b.avgSpeedKmh - a.avgSpeedKmh);
    const best = sorted[0];
    clusters.push({
      id: `paw-${++seq}`,
      rideIds: group.map((g) => g.rideId).sort((a, b) => a - b),
      count: group.length,
      bestRideId: best.rideId,
      bestAvgSpeedKmh: best.avgSpeedKmh,
      totalKm: Math.round(group.reduce((s, g) => s + g.distanceKm, 0) * 10) / 10,
    });
  }
  clusters.sort((a, b) => b.count - a.count);
  return { generatedAt: new Date().toISOString(), clusters };
}
