/** 单次骑行元信息（列表/卡片用） */
export interface RideInfo {
  rideId: number;
  title: string;
  /** YYYY-MM-DD HH:mm:ss */
  date: string;
  distanceKm: number;
  movingTimeSec: number;
  ascentM: number;
  avgSpeedKmh: number;
  device: string;
}

/** index.json / GET /api/activities 的结构（静态模式与服务端模式共用同一契约） */
export interface RidesIndex {
  generatedAt: string;
  totalKm: number;
  totalAscentM: number;
  rides: RideInfo[];
}

/** 服务端内部存储的一次完整骑行（详情 + 轨迹点） */
export interface RideRecord extends RideInfo {
  fitUrl: string;
  /** [lng, lat][] WGS84 */
  track: [number, number][];
}

/** 猫径：被反复骑行的相似线路（聚类结果） */
export interface RouteCluster {
  id: string;
  rideIds: number[];
  count: number;
  /** 均速最高的一次 = 最佳成绩 */
  bestRideId: number;
  bestAvgSpeedKmh: number;
  totalKm: number;
}

/** clusters.json / GET /api/clusters 的结构 */
export interface ClustersIndex {
  generatedAt: string;
  clusters: RouteCluster[];
}
