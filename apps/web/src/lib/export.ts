/** 路书导出：GPX（码表/Strava 通用）+ 分享卡片 PNG（纯前端 canvas 生成） */
import type { RideInfo, RideSeriesPoint } from '@lonelycat/shared';

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** 导出 GPX（含海拔；有逐秒序列时附带时间戳） */
export function exportGpx(ride: RideInfo, track: [number, number][], series?: RideSeriesPoint[]) {
  const aligned = series && series.length === track.length ? series : null;
  const base = Date.parse(ride.date.replace(' ', 'T'));
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

  const pts = track
    .map((c, i) => {
      const ele = aligned ? aligned[i]?.a : undefined;
      const t = aligned && aligned[i]?.t != null && Number.isFinite(base)
        ? new Date(base + aligned[i]!.t * 1000).toISOString()
        : undefined;
      return (
        `      <trkpt lat="${c[1]}" lon="${c[0]}">` +
        (ele != null ? `<ele>${ele.toFixed(1)}</ele>` : '') +
        (t ? `<time>${t}</time>` : '') +
        `</trkpt>`
      );
    })
    .join('\n');

  const gpx =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="猫踪 CatTrail" xmlns="http://www.topografix.com/GPX/1/1">\n` +
    `  <metadata><name>${esc(ride.title)} ${ride.date.slice(0, 10)}</name></metadata>\n` +
    `  <trk><name>${esc(ride.title)} ${ride.date.slice(0, 10)}</name><trkseg>\n${pts}\n  </trkseg></trk>\n` +
    `</gpx>\n`;

  triggerDownload(new Blob([gpx], { type: 'application/gpx+xml' }), `CatTrail_${ride.date.slice(0, 10)}_${ride.rideId}.gpx`);
}

/** 导出分享卡片 PNG（1200×675，夜巡品牌风格） */
export function exportShareCard(ride: RideInfo, track: [number, number][], theme: 'night' | 'day') {
  const W = 1200;
  const H = 675;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  const night = theme === 'night';
  const bg = night ? '#0a0e17' : '#f4f1e8';
  const trackColor = night ? '#ff6b35' : '#e8551f';
  const ink1 = night ? '#ffffff' : '#1d2430';
  const ink2 = night ? '#9aa5b8' : '#5b6472';
  const amber = night ? '#ffb347' : '#c2410c';
  const dim = night ? '#5b667a' : '#9aa0ab';

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 轨迹投影
  const lats = track.map((c) => c[1]);
  const lngs = track.map((c) => c[0]);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const padX = 90, padTop = 210, padBottom = 130;
  const dLng = Math.max(maxLng - minLng, 1e-6);
  const dLat = Math.max(maxLat - minLat, 1e-6);
  const scale = Math.min((W - padX * 2) / dLng, (H - padTop - padBottom) / dLat);
  const ox = (W - dLng * scale) / 2;
  const oy = padTop + (H - padTop - padBottom - dLat * scale) / 2;
  const px = (c: [number, number]) => ox + (c[0] - minLng) * scale;
  const py = (c: [number, number]) => oy + (maxLat - c[1]) * scale;

  // 轨迹（光晕 + 主线 + 高光）
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const drawTrack = (width: number, color: string, blur: number) => {
    ctx.beginPath();
    track.forEach((c, i) => (i === 0 ? ctx.moveTo(px(c), py(c)) : ctx.lineTo(px(c), py(c))));
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.shadowColor = trackColor;
    ctx.shadowBlur = blur;
    ctx.stroke();
    ctx.shadowBlur = 0;
  };
  drawTrack(14, night ? 'rgba(255,107,53,0.25)' : 'rgba(232,85,31,0.22)', 16);
  drawTrack(6, trackColor, 0);
  drawTrack(2, night ? '#ffd9c4' : '#ffe3d0', 0);

  // 起点标记
  ctx.beginPath();
  ctx.arc(px(track[0]), py(track[0]), 6, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // 文案
  ctx.textBaseline = 'top';
  ctx.fillStyle = trackColor;
  ctx.font = '700 30px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('🐈‍⬛ 猫踪 CatTrail', 60, 52);

  ctx.fillStyle = ink1;
  ctx.font = '700 52px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(`${ride.title} · ${ride.distanceKm.toFixed(1)} km`, 60, 112);

  ctx.fillStyle = ink2;
  ctx.font = '24px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(`${ride.date}  ·  ${ride.device}${ride.city ? '  ·  ' + ride.city : ''}`, 60, 164);

  // 数据条
  const stats: Array<[string, string]> = [
    [fmtDuration(ride.movingTimeSec), '记录时间'],
    [`${ride.avgSpeedKmh.toFixed(1)}`, '均速 km/h'],
    [`${ride.ascentM}`, '爬升 m'],
    [`${ride.maxSpeedKmh?.toFixed(1) ?? '—'}`, '极速 km/h'],
  ];
  const sw = (W - 120) / stats.length;
  stats.forEach(([v, k], i) => {
    const x = 60 + i * sw;
    ctx.fillStyle = amber;
    ctx.font = '700 34px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(v, x, H - 108);
    ctx.fillStyle = dim;
    ctx.font = '16px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(k, x, H - 66);
  });

  // 页脚
  ctx.strokeStyle = night ? 'rgba(126,141,173,.25)' : 'rgba(30,35,45,.18)';
  ctx.beginPath();
  ctx.moveTo(60, H - 40);
  ctx.lineTo(W - 60, H - 40);
  ctx.stroke();
  ctx.fillStyle = dim;
  ctx.font = '18px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('🐈‍⬛ 猫踪 CatTrail · ride the night, leave the trace', 60, H - 28);

  canvas.toBlob((blob) => {
    if (blob) triggerDownload(blob, `CatTrail_${ride.date.slice(0, 10)}_${ride.rideId}.png`);
  }, 'image/png');
}
