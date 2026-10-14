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

/**
 * FIT 头布局（14B）：头长度(1) + 协议版本(1) + profile版本(2LE) + 数据长度(4LE) + ".FIT"(4) + 头CRC(2)。
 * ".FIT" 魔数正常位于 bytes 8-11；个别写入方会把它放在 bytes 4-7（数据长度挪到 8-11），
 * fit-file-parser 只认前者——这里统一归一成解析器吃的布局。
 */
export function normalizeFitHeader(buf: Buffer): Buffer {
  if (buf.length >= 16 && buf.toString('latin1', 8, 12) === '.FIT') return buf;
  if (buf.length >= 16 && buf.toString('latin1', 4, 8) === '.FIT' && (buf[0] === 0x0c || buf[0] === 0x0e)) {
    const fixed = Buffer.from(buf);
    buf.copy(fixed, 8, 4, 8); // ".FIT" → 8-11
    buf.copy(fixed, 4, 8, 12); // 数据长度 → 4-7
    if (fixed[0] === 0x0e) {
      fixed[12] = 0;
      fixed[13] = 0; // 头 CRC 随字段交换失效，清零表示跳过头校验（fit-file-parser 约定）
    }
    return fixed;
  }
  return buf;
}

/** 宽松判断 Buffer 是否像 FIT 文件（两种头布局都认，用于导入/下载的准入校验） */
export function looksLikeFit(buf: Buffer): boolean {
  if (buf.length < 16 || (buf[0] !== 0x0c && buf[0] !== 0x0e)) return false;
  return buf.toString('latin1', 8, 12) === '.FIT' || buf.toString('latin1', 4, 8) === '.FIT';
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
    parser.parse(normalizeFitHeader(buf), (error: string | null, parsed: ParsedFit) => {
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
