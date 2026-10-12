/** 瓦片直连代理：浏览器只访问本服务，由 Node fetch 直连上游（不走系统代理，国内无需挂梯）。
 *  磁盘缓存 .cache/tiles/（30 天），上游失败回吐陈旧缓存；相同请求并发合并。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const UPSTREAM = 'https://tiles.openfreemap.org';
const TTL_MS = 30 * 24 * 3600 * 1000;
const CACHE_DIR = path.resolve(import.meta.dirname, '../../../../.cache/tiles');

export type TileEntry = { status: number; contentType: string; body: Buffer };

const inflight = new Map<string, Promise<TileEntry & { at: number }>>();

function diskPath(key: string, ext: string) {
  return path.join(CACHE_DIR, `${key}.${ext}`);
}

function readDisk(key: string): (TileEntry & { at: number }) | null {
  try {
    const meta = JSON.parse(fs.readFileSync(diskPath(key, 'json'), 'utf8')) as {
      status: number; contentType: string; at: number;
    };
    const body = fs.readFileSync(diskPath(key, 'bin'));
    return { ...meta, body };
  } catch {
    return null;
  }
}

function writeDisk(key: string, entry: TileEntry & { at: number }) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(diskPath(key, 'json'), JSON.stringify({
      status: entry.status, contentType: entry.contentType, at: entry.at,
    }));
    fs.writeFileSync(diskPath(key, 'bin'), entry.body);
  } catch { /* 缓存写失败不影响服务 */ }
}

/** 取上游资源（path 形如 /planet、/fonts/Noto%20Sans%20Regular/0-255.pbf） */
export async function fetchUpstream(pathAndQuery: string): Promise<TileEntry> {
  const url = UPSTREAM + pathAndQuery;
  const key = crypto.createHash('sha1').update(url).digest('hex');
  const cached = readDisk(key);
  if (cached && Date.now() - cached.at < TTL_MS) return cached;

  let p = inflight.get(key);
  if (!p) {
    p = (async () => {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 15000);
      try {
        const res = await fetch(url, {
          signal: ac.signal,
          headers: { 'user-agent': 'CatTrail/0.1 (self-hosted tile proxy)' },
        });
        const body = Buffer.from(await res.arrayBuffer());
        const entry = {
          status: res.status,
          contentType: res.headers.get('content-type') ?? 'application/octet-stream',
          body,
          at: Date.now(),
        };
        if (res.ok) writeDisk(key, entry);
        return entry;
      } finally {
        clearTimeout(timer);
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
  }

  try {
    return await p;
  } catch (err) {
    if (cached) return cached; // 断网/超时：回吐陈旧缓存
    throw err;
  }
}

/** TileJSON 重写：上游返回的瓦片绝对地址改写到同源 /tiles/ 下（origin 来自请求头） */
export function rewriteTileJSON(raw: string, origin: string): string {
  const base = origin ? `${origin}/tiles/` : '/tiles/';
  return raw.replaceAll('https://tiles.openfreemap.org/', base);
}

/** 请求头 → 页面同源 origin（Origin 优先，Referer 兜底；都没有返回空串走相对路径） */
export function originOf(headers: { origin?: string; referer?: string }): string {
  if (headers.origin) return headers.origin.replace(/\/$/, '');
  if (headers.referer) {
    try { return new URL(headers.referer).origin; } catch { /* ignore */ }
  }
  return '';
}
