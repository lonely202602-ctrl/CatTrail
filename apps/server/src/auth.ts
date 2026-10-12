/** 认证工具：scrypt 口令哈希 + 随机会话令牌（node:crypto，零依赖） */
import crypto from 'node:crypto';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

export function newToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function newUserId(): string {
  return crypto.randomUUID();
}
