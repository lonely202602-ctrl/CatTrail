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
  calorie?: number;
  maxSpeedKmh?: number;
  /** 起点所在省/市（同步时离线反查） */
  province?: string;
  city?: string;
}

/** index.json / GET /api/activities 的结构（静态模式与服务端模式共用同一契约） */
export interface RidesIndex {
  generatedAt: string;
  totalKm: number;
  totalAscentM: number;
  rides: RideInfo[];
}

/** 轨迹逐秒采样点：t=起始秒, s=速度km/h, a=海拔m, h=心率 */
export interface RideSeriesPoint {
  t: number;
  s?: number;
  a?: number;
  h?: number;
}

/** 服务端内部存储的一次完整骑行（详情 + 轨迹点 + 逐秒序列） */
export interface RideRecord extends RideInfo {
  fitUrl: string;
  /** [lng, lat][] WGS84 */
  track: [number, number][];
  series?: RideSeriesPoint[];
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
