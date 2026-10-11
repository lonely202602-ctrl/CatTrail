/**
 * iGPSPORT 请求签名器。
 *
 * 合规说明：本模块不在仓库中分发 iGPSPORT 的任何代码或二进制。
 * 运行时从其公开网页拉取官方 WASM 与 wasm-bindgen 胶水层（两者本就是
 * 浏览器正常加载的公开静态资源），在本地调用官方算法生成与网页版一致的
 * 请求签名。官方更新后无需改代码，重新拉取即可。
 */
import crypto from 'node:crypto';

const WEB_BASE = 'https://app.igpsport.cn';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

interface GlueBundle {
  glue: string;
  wasmUrl: string;
}
interface Sandbox {
  PT: (src: unknown) => Promise<void>;
  cF: (method: string, fullPath: string, timestamp: string, nonce: string, body: Uint8Array) => string;
  uF: (secret: Uint8Array) => boolean;
}

let bundleCache: GlueBundle | null = null;
let signerBySecret = new Map<string, Sandbox>();

/** 从官方入口 HTML → 主包 JS 中定位 wasm-bindgen 胶水层与 WASM 地址 */
async function loadBundle(): Promise<GlueBundle> {
  if (bundleCache) return bundleCache;
  const html = await (await fetch(WEB_BASE + '/', { headers: { 'User-Agent': UA } })).text();
  const entry = html.match(/src="(\/assets\/js\/[^"]+\.js)"/)?.[1];
  if (!entry) throw new Error('iGPSPORT 入口 JS 未找到，官方页面结构可能已变更');
  const bundle = await (await fetch(WEB_BASE + entry, { headers: { 'User-Agent': UA } })).text();
  const start = bundle.indexOf('let St;');
  const end = bundle.indexOf('const pF=', start);
  if (start < 0 || end < 0) throw new Error('胶水层区域定位失败，官方主包可能已变更');
  const wasmUrl =
    WEB_BASE +
    (bundle.match(/\/assets\/edge_core_wasm_bg-[A-Za-z0-9_-]+\.wasm/)?.[0] ??
      '/assets/edge_core_wasm_bg-GHC38n8Q.wasm');
  bundleCache = { glue: bundle.slice(start, end), wasmUrl };
  return bundleCache;
}

/** 官方 RF 逻辑：secret_key(base64url) → 字节 */
function decodeSecret(e: string): Uint8Array {
  const t = e.replace(/\s+/g, '');
  const o = t.replace(/-/g, '+').replace(/_/g, '/').padEnd(t.length + ((4 - (t.length % 4)) % 4), '=');
  const n = Buffer.from(o, 'base64');
  return new Uint8Array(n);
}

/** 官方 OF 逻辑：请求体 → UTF-8 字节（对象转 JSON） */
function encodeBody(body?: string | object): Uint8Array {
  if (body == null) return new Uint8Array(0);
  const s = typeof body === 'string' ? body : JSON.stringify(body);
  return new TextEncoder().encode(s);
}

/** 初始化（每个 secret 一次）：加载官方 WASM 并注入会话密钥 */
export async function getSigner(secretKeyB64: string): Promise<Sandbox> {
  const hit = signerBySecret.get(secretKeyB64);
  if (hit) return hit;
  const { glue, wasmUrl } = await loadBundle();
  const wrapped = glue.replaceAll('import.meta.url', JSON.stringify(WEB_BASE + '/'));
  const sandbox = new Function(`${wrapped}; return { PT, cF, uF };`)() as Sandbox;
  const wasm = new Uint8Array(await (await fetch(wasmUrl, { headers: { 'User-Agent': UA } })).arrayBuffer());
  await sandbox.PT(new Response(wasm, { headers: { 'content-type': 'application/wasm' } }));
  if (!sandbox.uF(decodeSecret(secretKeyB64))) throw new Error('init_session_key 失败');
  signerBySecret.set(secretKeyB64, sandbox);
  return sandbox;
}

export interface Signature {
  timestamp: string;
  nonce: string;
  signature: string;
}

/** 生成一条请求的签名三件套 */
export async function sign(
  secretKeyB64: string,
  method: string,
  fullPath: string,
  body?: string | object,
): Promise<Signature> {
  const { cF } = await getSigner(secretKeyB64);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomUUID();
  const signature = cF(method.toUpperCase(), fullPath, timestamp, nonce, encodeBody(body));
  return { timestamp, nonce, signature };
}
