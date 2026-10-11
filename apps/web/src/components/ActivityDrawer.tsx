/** 轨迹分析抽屉：双击线路打开 —— 数据网格 + 速度/海拔/心率曲线（手写 SVG，零图表库）+ 路书导出/回放 */
import { useMemo, useState } from 'react';
import type { RideInfo, RideSeriesPoint } from '@lonelycat/shared';
import { exportGpx, exportShareCard } from '../lib/export';

interface Props {
  ride: RideInfo;
  series: RideSeriesPoint[];
  theme: 'night' | 'day';
  track: [number, number][];
  onReplay: () => void;
  onClose: () => void;
}

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const CHART_COLORS = {
  night: { speed: ['#ff8a5c', '#ff6b35'], alt: ['#5fd4a8', '#2f9e8f'], hr: ['#ff7a7a', '#e05656'], axis: '#5b667a' },
  day: { speed: ['#ff9a63', '#e8551f'], alt: ['#5fc4ae', '#2f9e8f'], hr: ['#f08a8a', '#d6455f'], axis: '#98a0af' },
} as const;

export default function ActivityDrawer({ ride, series, theme, track, onReplay, onClose }: Props) {
  const colors = CHART_COLORS[theme];
  const tMax = series.length > 0 ? series[series.length - 1].t : 0;

  const speedData = useMemo(() => series.filter((p) => p.s != null).map((p) => ({ x: p.t, y: p.s! })), [series]);
  const altData = useMemo(() => series.filter((p) => p.a != null).map((p) => ({ x: p.t, y: p.a! })), [series]);
  const hrData = useMemo(() => series.filter((p) => p.h != null).map((p) => ({ x: p.t, y: p.h! })), [series]);

  return (
    <div className="drawer">
      <div className="drawer__head">
        <div>
          <div className="drawer__title">🐾 {ride.title}</div>
          <div className="drawer__sub">{ride.date} · {ride.device}</div>
        </div>
        <button className="drawer__close" onClick={onClose} aria-label="关闭">✕</button>
      </div>

      <div className="drawer__stats">
        <div><b>{ride.distanceKm.toFixed(2)}</b><span>距离 km</span></div>
        <div><b>{fmtDuration(ride.movingTimeSec)}</b><span>记录时间</span></div>
        <div><b>{ride.avgSpeedKmh.toFixed(1)}</b><span>平均速度 km/h</span></div>
        <div><b>{ride.ascentM}</b><span>累计爬升 m</span></div>
        <div><b>{ride.calorie ?? '—'}</b><span>卡路里 kcal</span></div>
        <div><b>{ride.maxSpeedKmh != null ? ride.maxSpeedKmh.toFixed(1) : '—'}</b><span>最高速度 km/h</span></div>
      </div>

      <div className="drawer__actions">
        <button onClick={() => exportGpx(ride, track, series)}>⬇ 导出 GPX</button>
        <button onClick={() => exportShareCard(ride, track, theme)}>🖼 分享卡片</button>
        <button onClick={onReplay}>▶ 骑行回放</button>
      </div>

      <div className="drawer__charts">
        {speedData.length > 1 && (
          <AreaChart data={speedData} tMax={tMax} colors={colors.speed} axis={colors.axis}
            title="速度" unit="km/h" height={120} />
        )}
        {altData.length > 1 && (
          <AreaChart data={altData} tMax={tMax} colors={colors.alt} axis={colors.axis}
            title="海拔" unit="m" height={100} />
        )}
        {hrData.length > 1 && (
          <AreaChart data={hrData} tMax={tMax} colors={colors.hr} axis={colors.axis}
            title="心率" unit="bpm" height={100} />
        )}
      </div>

      <div className="drawer__foot">数据来源：iGPSPORT FIT 逐秒采样 · 双击线路随时打开</div>
    </div>
  );
}

/** 手写 SVG 面积图：渐变填充 + 悬停十字线与数值气泡 */
function AreaChart({
  data, tMax, colors, axis, title, unit, height,
}: {
  data: { x: number; y: number }[];
  tMax: number;
  colors: [string, string];
  axis: string;
  title: string;
  unit: string;
  height: number;
}) {
  const [hover, setHover] = useState<{ i: number; px: number } | null>(null);
  const W = 400;
  const H = height;
  const PAD_B = 18;

  const ys = data.map((d) => d.y);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const yPad = (yMax - yMin) * 0.12 || 1;
  const lo = yMin - yPad;
  const hi = yMax + yPad;

  const X = (t: number) => (tMax > 0 ? (t / tMax) * W : 0);
  const Y = (v: number) => H - PAD_B - ((v - lo) / (hi - lo)) * (H - PAD_B - 8);

  const linePath = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${X(d.x).toFixed(1)},${Y(d.y).toFixed(1)}`).join('');
  const areaPath = `${linePath}L${W},${H - PAD_B}L0,${H - PAD_B}Z`;
  const gid = `g-${title}-${colors[1].replace(/[^a-z0-9]/gi, '')}`;

  const avg = ys.reduce((s, v) => s + v, 0) / (ys.length || 1);

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const t = ratio * tMax;
    let best = 0;
    let bestGap = Infinity;
    for (let i = 0; i < data.length; i++) {
      const gap = Math.abs(data[i].x - t);
      if (gap < bestGap) { bestGap = gap; best = i; }
    }
    setHover({ i: best, px: ratio });
  };

  const hp = hover ? data[hover.i] : null;

  return (
    <div className="chart">
      <div className="chart__head">
        <span className="chart__title">{title}</span>
        <span className="chart__avg">平均 <b>{avg.toFixed(1)}</b> {unit}</span>
      </div>
      <div className="chart__body" onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ height: H }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colors[0]} stopOpacity="0.5" />
              <stop offset="100%" stopColor={colors[1]} stopOpacity="0.05" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${gid})`} />
          <path d={linePath} fill="none" stroke={colors[1]} strokeWidth="1.4"
            vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          {hover && (
            <line x1={X(data[hover.i].x)} y1="0" x2={X(data[hover.i].x)} y2={H - PAD_B}
              stroke={axis} strokeWidth="1" vectorEffect="non-scaling-stroke" strokeDasharray="3 3" />
          )}
        </svg>
        {hp && (
          <div className="chart__tip"
            style={{ left: `${hover!.px * 100}%`, transform: hover!.px > 0.8 ? 'translateX(-100%)' : 'none' }}>
            <b>{hp.y.toFixed(1)}</b> {unit}<br />
            <span>{fmtDuration(hp.x)}</span>
          </div>
        )}
        <div className="chart__axis">
          <span>{fmtDuration(0)}</span>
          <span>{fmtDuration(tMax)}</span>
        </div>
      </div>
    </div>
  );
}
