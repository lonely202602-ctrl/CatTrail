/**
 * iGPSPORT API 客户端（仅访问当前授权用户本人的数据）。
 * 端点均为网页版同款；调用频率由 sync 层控制在 ~1 req/s。
 */
import { sign } from './signer.js';

const API_BASE = 'https://prod.zh.igpsport.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export interface EdgeKeys {
  access_key: string;
  secret_key: string;
}

export interface LoginResult {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface ActivityRow {
  rideId: number;
  title: string;
  startTime: string;
  rideDistance: number;
  totalMovingTime: number;
  totalAscent: number;
  avgSpeed: number;
  productName: string;
  [k: string]: unknown;
}

export interface ActivityDetail extends ActivityRow {
  fitUrl: string;
  endTime: string;
  totalTime: number;
  calorie: number;
  avgAltitude: number;
  maxAltitude: number;
  minAltitude: number;
  [k: string]: unknown;
}

function baseHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-Hans',
    TimeZone: 'Asia/Shanghai',
    'Qiwu-App-Version': '8.07.08',
    'X-Platform': 'web',
    'User-Agent': UA,
    Origin: 'https://app.igpsport.cn',
    Referer: 'https://app.igpsport.cn/',
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function signedFetch(
  keys: EdgeKeys,
  token: string | undefined,
  method: 'GET' | 'POST',
  fullPath: string,
  body?: string | object,
): Promise<unknown> {
  const sig = await sign(keys.secret_key, method, fullPath, body);
  const headers = {
    ...baseHeaders(token),
    'X-Access-Key': keys.access_key,
    'X-Timestamp': sig.timestamp,
    'X-Nonce': sig.nonce,
    'X-Signature': sig.signature,
  };
  const res = await fetch(API_BASE + fullPath, {
    method,
    headers: body != null ? { ...headers, 'Content-Type': 'application/json' } : headers,
    body: body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
  const text = await res.text();
  let json: { code?: number; message?: string; data?: unknown };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`iGPSPORT ${method} ${fullPath} 返回非 JSON (HTTP ${res.status}): ${text.slice(0, 120)}`);
  }
  if (res.status !== 200 || (json.code !== 0 && json.code !== undefined)) {
    throw new Error(`iGPSPORT ${method} ${fullPath} 失败 (HTTP ${res.status}): ${json.message ?? text.slice(0, 120)}`);
  }
  return 'data' in json && json.data !== undefined ? json.data : json;
}

/** 匿名获取全局签名密钥 */
export async function getEdgeKeys(): Promise<EdgeKeys> {
  const res = await fetch(`${API_BASE}/service/edge-core/api/public/key`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`获取签名密钥失败 HTTP ${res.status}`);
  return (await res.json()).data as EdgeKeys;
}

/** 账号密码登录（仅用于访问本人数据） */
export async function login(keys: EdgeKeys, username: string, password: string): Promise<LoginResult> {
  const body = { appId: 'igpsport-web', username, password };
  const data = (await signedFetch(keys, undefined, 'POST', '/service/auth/account/login', body)) as LoginResult;
  if (!data?.access_token) throw new Error('登录响应缺少 access_token');
  return data;
}

/** 分页拉取本人全部活动（自动翻页） */
export async function listAllActivities(keys: EdgeKeys, token: string): Promise<ActivityRow[]> {
  const all: ActivityRow[] = [];
  for (let pageNo = 1; ; pageNo++) {
    const p = `/service/web-gateway/web-analyze/activity/queryMyActivity?pageNo=${pageNo}&pageSize=50&reqType=0&sort=1&sortType=1`;
    const data = (await signedFetch(keys, token, 'GET', p)) as { rows: ActivityRow[]; totalRows: number };
    all.push(...(data.rows ?? []));
    if (all.length >= (data.totalRows ?? 0) || (data.rows ?? []).length === 0) break;
    await sleep(1100);
  }
  return all;
}

/** 单次骑行详情（含 fitUrl） */
export async function getActivityDetail(keys: EdgeKeys, token: string, rideId: number): Promise<ActivityDetail> {
  return (await signedFetch(
    keys,
    token,
    'GET',
    `/service/web-gateway/web-analyze/activity/queryActivityDetail/${rideId}`,
  )) as ActivityDetail;
}

/** 下载 FIT 原始文件（OSS 直链，无需签名），并校验内容确为 FIT */
export async function downloadFit(fitUrl: string): Promise<Buffer> {
  const res = await fetch(fitUrl);
  if (!res.ok) throw new Error(`FIT 下载失败 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // FIT 文件头：bytes 4-7 固定为 ".FIT"；链接失效/被拦时 OSS 常返回 200 + XML/HTML 错误页
  if (buf.length < 12 || buf.toString('latin1', 4, 8) !== '.FIT') {
    const sniff = buf.subarray(0, 120).toString('utf8').replace(/[^\x20-\x7e]/g, ' ').trim().slice(0, 80);
    throw new Error(
      `下载内容不是有效 FIT 文件（content-type: ${res.headers.get('content-type') ?? '未知'}, ${buf.length} 字节${sniff ? `, 开头: ${sniff}` : ''}）`,
    );
  }
  return buf;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
