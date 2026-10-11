const fs = require('fs');
const src = fs.readFileSync('apps/web/src/map/RideMap.tsx', 'utf8');
let depth = 0, line = 1, inStr = null, inLC = false, inBC = false;
const marks = [];
for (let i = 0; i < src.length; i++) {
  const ch = src[i];
  const next = src[i + 1];
  if (ch === '\n') { line++; inLC = false; continue; }
  if (inLC) continue;
  if (inBC) { if (ch === '*' && next === '/') { inBC = false; i++; } continue; }
  if (inStr) {
    if (ch === '\\') { i++; continue; }
    if (ch === inStr) inStr = null;
    continue;
  }
  if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
  if (ch === '/' && next === '/') { inLC = true; continue; }
  if (ch === '/' && next === '*') { inBC = true; i++; continue; }
  if (ch === '{') depth++;
  else if (ch === '}') depth--;
  if (src.slice(i, i + 9) === 'function ' && depth !== 1) {
    marks.push('function @' + line + ' depth=' + depth);
  }
}
console.log(marks.join('\n') || 'function 声明处深度正常');
