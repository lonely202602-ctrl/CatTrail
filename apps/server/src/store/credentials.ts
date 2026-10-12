/** iGPSPORT 凭据存储：base64 混淆后落盘 .cache/igpsport-auth.json（自部署服务器本地，不入仓库） */
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.resolve(import.meta.dirname, '../../../../.cache/igpsport-auth.json');

export interface StoredCreds {
  username: string;
  password: string;
}

export function readCreds(): StoredCreds | null {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as { u: string; p: string };
    if (!raw.u || !raw.p) return null;
    return {
      username: Buffer.from(raw.u, 'base64url').toString('utf8'),
      password: Buffer.from(raw.p, 'base64url').toString('utf8'),
    };
  } catch {
    return null;
  }
}

export function writeCreds(username: string, password: string): void {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(
    FILE,
    JSON.stringify({
      u: Buffer.from(username, 'utf8').toString('base64url'),
      p: Buffer.from(password, 'utf8').toString('base64url'),
    }),
  );
}

export function clearCreds(): void {
  try {
    fs.rmSync(FILE);
  } catch {
    /* 不存在即已解绑 */
  }
}

/** 展示用脱敏：a***@qq.com / 138****1234 */
export function maskUsername(u: string): string {
  const at = u.indexOf('@');
  if (at > 0) {
    const local = u.slice(0, at);
    return `${local.slice(0, 2)}${'*'.repeat(Math.max(local.length - 2, 2))}${u.slice(at)}`;
  }
  return `${u.slice(0, 3)}${'*'.repeat(Math.max(u.length - 3, 2)).slice(0, 6)}`;
}
