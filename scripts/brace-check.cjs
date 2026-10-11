const fs = require('fs');
const src = fs.readFileSync('apps/web/src/map/RideMap.tsx', 'utf8');
let depth = 0;
let line = 1;
let inStr = null;
let inLineComment = false;
let inBlockComment = false;
const negatives = [];
for (let i = 0; i < src.length; i++) {
  const ch = src[i];
  const next = src[i + 1];
  if (ch === '\n') { line++; inLineComment = false; continue; }
  if (inLineComment) continue;
  if (inBlockComment) { if (ch === '*' && next === '/') { inBlockComment = false; i++; } continue; }
  if (inStr) {
    if (ch === '\\') { i++; continue; }
    if (ch === inStr) inStr = null;
    continue;
  }
  if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
  if (ch === '/' && next === '/') { inLineComment = true; continue; }
  if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
  if (ch === '{') depth++;
  else if (ch === '}') {
    depth--;
    if (depth < 0) { negatives.push(line); depth = 0; }
  }
}
console.log('结束深度:', depth);
console.log('多余的 } 行:', negatives.join(', ') || '无');
