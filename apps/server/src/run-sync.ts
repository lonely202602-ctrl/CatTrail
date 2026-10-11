/** 同步 CLI 入口：npm run sync */
import path from 'node:path';
import { runSync } from './sync/sync.js';

const username = process.env.IGPSPORT_USERNAME;
const password = process.env.IGPSPORT_PASSWORD;
if (!username || !password) {
  console.error('缺少 IGPSPORT_USERNAME / IGPSPORT_PASSWORD（复制 apps/server/.env.example 为仓库根 .env 并填写）');
  process.exit(1);
}

const dataDir = path.resolve(import.meta.dirname, process.env.DATA_DIR ?? '../../../data');
console.log(`猫踪 CatTrail 同步开始 → ${dataDir}`);
const summary = await runSync({ username, password, dataDir });
console.log(
  `完成：云端 ${summary.fetched} 条，新增 ${summary.added} 条，跳过 ${summary.skipped} 条，总里程 ${summary.totalKm}km`,
);
