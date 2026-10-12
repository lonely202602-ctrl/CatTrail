/** FIT 二进制 → GPS 轨迹点 + 元信息（fit-file-parser 已把 semicircles 转成度） */
import FitFileParser from 'fit-file-parser';

export interface TrackPoint {
  lat: number;
  lng: number;
  alt?: number;
  hr?: number;
  spd?: number;
  time?: string;
}

export interface FitMeta {
  /** 首个记录点时间（ISO） */
  startTime?: string;
  /** 累计距离 m（取最后一个非空 distance） */
  totalDistanceM?: number;
  maxSpeedKmh?: number;
  calories?: number;
}

interface ParsedFit {
  records?: Array<{
    position_lat?: number;
    position_long?: number;
    altitude?: number;
    enhanced_altitude?: number;
    heart_rate?: number;
    timestamp?: Date | number | string;
    distance?: number;
    speed?: number;
    cadence?: number;
    power?: number;
  }>;
  sessions?: Array<{ total_calories?: number; sport?: string }>;
}

export async function parseFit(buf: Buffer): Promise<{ points: TrackPoint[]; meta: FitMeta }> {
  const parser = new FitFileParser({
    mode: 'list',
    speedUnit: 'km/h',
    lengthUnit: 'm',
    temperature: true,
    elapsedRecordField: false,
    includeRawRecord: false,
  });
  const data = await new Promise<ParsedFit>((resolve, reject) => {
    parser.parse(buf, (error: string | null, parsed: ParsedFit) => {
      if (error) reject(new Error(`FIT 解析失败: ${error}`));
      else resolve(parsed);
    });
  });
  const points: TrackPoint[] = [];
  let totalDistanceM: number | undefined;
  let maxSpeedKmh: number | undefined;
  let startTime: string | undefined;
  for (const r of data.records ?? []) {
    const lat = r.position_lat;
    const lng = r.position_long;
    if (r.distance != null) totalDistanceM = r.distance;
    if (r.speed != null && (maxSpeedKmh == null || r.speed > maxSpeedKmh)) maxSpeedKmh = r.speed;
    if (r.timestamp && !startTime) startTime = new Date(r.timestamp as string).toISOString();
    if (lat == null || lng == null) continue;
    points.push({
      lat,
      lng,
      alt: (r.enhanced_altitude ?? r.altitude) ?? undefined,
      hr: r.heart_rate ?? undefined,
      spd: r.speed ?? undefined,
      time: r.timestamp ? new Date(r.timestamp as string).toISOString() : undefined,
    });
  }
  const calories = data.sessions?.[0]?.total_calories;
  return { points, meta: { startTime, totalDistanceM, maxSpeedKmh, calories } };
}
