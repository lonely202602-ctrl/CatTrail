/** FIT 二进制 → GPS 轨迹点（fit-file-parser 已把 semicircles 转成度） */
import FitFileParser from 'fit-file-parser';

export interface TrackPoint {
  lat: number;
  lng: number;
  alt?: number;
  hr?: number;
  time?: string;
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
}

export async function parseFit(buf: Buffer): Promise<TrackPoint[]> {
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
  const out: TrackPoint[] = [];
  for (const r of data.records ?? []) {
    const lat = r.position_lat;
    const lng = r.position_long;
    if (lat == null || lng == null) continue;
    out.push({
      lat,
      lng,
      alt: (r.enhanced_altitude ?? r.altitude) ?? undefined,
      hr: r.heart_rate ?? undefined,
      time: r.timestamp ? new Date(r.timestamp as string).toISOString() : undefined,
    });
  }
  return out;
}
