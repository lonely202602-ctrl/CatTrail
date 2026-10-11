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
