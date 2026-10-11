/**
 * 行政区划反查：DataV GeoAtlas 免费边界数据（阿里云，无 key）。
 * 省级边界全量缓存一次；城市级按需缓存有骑行的省份。射线法点内判定，纯本地计算。
 */
import fs from 'node:fs';
import path from 'node:path';

const CACHE_DIR = path.resolve(import.meta.dirname, '../../../../.cache/geo');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const DATAV = 'https://geo.datav.aliyun.com/areas_v3/bound';

/** 直辖市的"市级"就是市本身 */
const MUNICIPALITIES = new Set([110000, 120000, 310000, 500000]);

interface GeoFeature {
  properties: { name: string; adcode: number; level?: string };
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] };
}

async function fetchBoundaries(adcode: number): Promise<GeoFeature[]> {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `${adcode}_full.json`);
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, 'utf8')).features as GeoFeature[];
  }
  const res = await fetch(`${DATAV}/${adcode}_full.json`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`行政区划边界获取失败 HTTP ${res.status} (adcode=${adcode})`);
  const json = await res.json();
  fs.writeFileSync(file, JSON.stringify(json));
  return json.features as GeoFeature[];
}

/** 射线法：点是否在环内 */
function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInGeometry(lng: number, lat: number, geom: GeoFeature['geometry']): boolean {
  if (geom.type === 'Polygon') {
    const rings = geom.coordinates as number[][][];
    return pointInRing(lng, lat, rings[0]); // 外环判定足够（省界含飞地误差可忽略）
  }
  for (const poly of geom.coordinates as number[][][][]) {
    if (pointInRing(lng, lat, poly[0])) return true;
  }
  return false;
}

let provincesPromise: Promise<GeoFeature[]> | null = null;
const cityCache = new Map<number, GeoFeature[]>();

export interface Region {
  province: string;
  city: string;
}

/** 反查一次骑行的省/市（起点坐标） */
export async function resolveRegion(lng: number, lat: number): Promise<Region> {
  if (!provincesPromise) provincesPromise = fetchBoundaries(100000);
  const provinces = await provincesPromise;
  for (const f of provinces) {
    if (!pointInGeometry(lng, lat, f.geometry)) continue;
    const province = f.properties.name;
    const adcode = f.properties.adcode;
    let city = MUNICIPALITIES.has(adcode) ? province : '';
    try {
      if (!cityCache.has(adcode)) cityCache.set(adcode, fetchBoundaries(adcode));
      const cities = await cityCache.get(adcode)!;
      for (const c of cities) {
        if (pointInGeometry(lng, lat, c.geometry)) {
          city = c.properties.name;
          break;
        }
      }
    } catch {
      // 城市级失败不影响省级标注
    }
    return { province, city };
  }
  return { province: '', city: '' };
}
