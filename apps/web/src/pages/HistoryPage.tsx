/** 骑行历史页：年度打卡热力图 + 骑行记录列表 + 居中详情卡片（iGPSPORT 风格） + FIT 手动导入 */
import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { RideInfo, RideSeriesPoint } from '@lonelycat/shared';
import type { TrackFC } from '../data/adapter';
import { DATA_MODE, deleteRide, fetchSeries, renameRide, uploadFit } from '../data/adapter';
import { AreaChart } from '../components/ActivityDrawer';
import { PageDecor } from './AuthPage';
import { buildStyle, trailPalette } from '../map/mapStyle';
import { exportGpx, exportShareCard, fmtDuration } from '../lib/export';

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

/* ---------------- 年度打卡热力图（GitHub contributions 风格，品牌橙） ---------------- */

function heatLevel(km: number): 0 | 1 | 2 | 3 | 4 {
  if (km <= 0) return 0;
  if (km < 10) return 1;
  if (km < 25) return 2;
  if (km < 40) return 3;
  return 4;
}

function Heatmap({ rides }: { rides: RideInfo[] }) {
  const data = useMemo(() => {
    const byDay = new Map<string, { count: number; km: number }>();
    for (const r of rides) {
      const d = r.date.slice(0, 10);
      const cur = byDay.get(d) ?? { count: 0, km: 0 };
      byDay.set(d, { count: cur.count + 1, km: cur.km + r.distanceKm });
    }
    // 近一年：以今天为终点，对齐到周一开始的 7 行 × N 列
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const end = new Date(today);
    end.setDate(end.getDate() + (7 - ((end.getDay() + 6) % 7) - 1)); // 补到本周日
    const start = new Date(end);
    start.setDate(start.getDate() - 364);
    const cells: Array<Array<{ key: string; km: number; count: number; label: string } | null>> = [[], [], [], [], [], [], []];
    const months: Array<{ col: number; label: string }> = [];
    let lastMonth = -1;
    const cur = new Date(start);
    let col = 0;
    while (cur <= end) {
      const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
      const hit = byDay.get(key) ?? { count: 0, km: 0 };
      cells[(cur.getDay() + 6) % 7][col] = {
        key,
        km: Math.round(hit.km * 10) / 10,
        count: hit.count,
        label: key,
      };
      if (cur.getDate() <= 7 && cur.getMonth() !== lastMonth) {
        lastMonth = cur.getMonth();
        months.push({ col, label: `${cur.getMonth() + 1}月` });
      }
      if ((cur.getDay() + 6) % 7 === 6) col++;
      cur.setDate(cur.getDate() + 1);
    }
    const totalRides = rides.length;
    const totalKm = Math.round(rides.reduce((s, r) => s + r.distanceKm, 0) * 10) / 10;
    return { cells, months, totalRides, totalKm, cols: col };
  }, [rides]);

  const CELL = 11;
  const GAP = 3;
  const PAD_L = 30;
  const PAD_T = 18;
  const width = PAD_L + data.cols * (CELL + GAP) + 8;
  const height = PAD_T + 7 * (CELL + GAP) + 6;

  const best = useMemo(
    () =>
      [...data.cells.flat()].reduce(
        (max, c) => (c && c.km > (max?.km ?? 0) ? c : max),
        null as { km: number; label: string } | null,
      ),
    [data],
  );

  return (
    <div className="heatmap">
      <div className="heatmap__head">
        <span className="heatmap__chip"><b>{data.totalRides}</b> 次骑行</span>
        <span className="heatmap__chip">共 <b>{data.totalKm}</b> km</span>
        {best && <span className="heatmap__chip">单日最长 <b>{best.km}</b> km</span>}
        <span className="heatmap__legend">
          少
          {[0, 1, 2, 3, 4].map((l) => (
            <i key={l} className={`heatmap__cell heatmap__cell--l${l}`} />
          ))}
          多
        </span>
      </div>
      <div className="heatmap__scroll">
        <svg width={width} height={height} className="heatmap__svg" role="img" aria-label="近一年骑行打卡热力图">
          {['一', '三', '五', '日'].map((w, i) => (
            <text key={w} x={PAD_L - 8} y={PAD_T + [0, 2, 4, 6][i] * (CELL + GAP) + CELL - 2} textAnchor="end" className="heatmap__wk">
              {w}
            </text>
          ))}
          {data.months.map((m) => (
            <text key={m.col} x={PAD_L + m.col * (CELL + GAP)} y={12} className="heatmap__mo">
              {m.label}
            </text>
          ))}
          {data.cells.map((row, r) =>
            row.map((cell, c) =>
              cell ? (
                <rect
                  key={cell.key}
                  x={PAD_L + c * (CELL + GAP)}
                  y={PAD_T + r * (CELL + GAP)}
                  width={CELL}
                  height={CELL}
                  rx={3}
                  className={`heatmap__cell heatmap__cell--l${heatLevel(cell.km)}`}
                >
                  <title>{`${cell.label}${cell.count ? ` · ${cell.count} 次 · ${cell.km} km` : ' · 未骑行'}`}</title>
                </rect>
              ) : null,
            ),
          )}
        </svg>
      </div>
    </div>
  );
}

/* ---------------- 居中详情卡片（iGPSPORT 风格：大数字统计 + 曲线 + 轨迹缩略图） ---------------- */

/** 详情卡片内的真实地图底图缩略图（复用瓦片代理与主题样式，无交互） */
function TrackMiniMap({ track, theme }: { track: [number, number][]; theme: 'night' | 'day' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: buildStyle(theme),
      interactive: false,
      attributionControl: { compact: true },
      renderWorldCopies: false,
      fadeDuration: 0,
    });
    map.on('load', () => {
      if (!map.getSource('ride')) {
        map.addSource('ride', {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: track } },
        });
      }
      if (!map.getLayer('ride-glow')) {
        const C = trailPalette(theme);
        map.addLayer({
          id: 'ride-glow',
          type: 'line',
          source: 'ride',
          paint: { 'line-color': C.track, 'line-width': 10, 'line-opacity': 0.28, 'line-blur': 4 },
        });
        map.addLayer({
          id: 'ride-line',
          type: 'line',
          source: 'ride',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': C.track, 'line-width': 3.5 },
        });
      }
      const b = new maplibregl.LngLatBounds();
      track.forEach((c) => b.extend(c));
      map.fitBounds(b, { padding: 42, duration: 0, essential: true });
    });
    return () => map.remove();
  }, [track, theme]);
  return <div ref={ref} className="rdcard__track rdcard__map" />;
}

function RideDetailCard({
  ride, track, theme, onClose, onDataChanged,
}: {
  ride: RideInfo;
  track: [number, number][];
  theme: 'night' | 'day';
  onClose: () => void;
  onDataChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(ride.title);
  const [busy, setBusy] = useState(false);

  const saveTitle = async () => {
    const clean = draft.trim().slice(0, 60);
    if (!clean || clean === ride.title) {
      setEditing(false);
      setDraft(ride.title);
      return;
    }
    setBusy(true);
    try {
      await renameRide(ride.rideId, clean);
      onDataChanged();
    } catch (e) {
      window.alert(String((e as Error).message));
    } finally {
      setBusy(false);
      setEditing(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(ride.demo ? '确定删除这条演示数据？删除后所有用户都不再显示。' : `确定删除「${ride.title}」？此操作不可恢复。`)) return;
    setBusy(true);
    try {
      await deleteRide(ride.rideId);
      onDataChanged();
      onClose();
    } catch (e) {
      window.alert(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const [series, setSeries] = useState<RideSeriesPoint[]>([]);
  const [seriesErr, setSeriesErr] = useState(false);
  useEffect(() => {
    let alive = true;
    fetchSeries(ride.rideId)
      .then((s) => alive && setSeries(s))
      .catch(() => alive && setSeriesErr(true));
    return () => { alive = false; };
  }, [ride.rideId]);

  const tMax = series.length > 0 ? series[series.length - 1].t : 0;
  const colors = theme === 'night'
    ? { speed: ['#ff8a5c', '#ff6b35'] as [string, string], alt: ['#5fd4a8', '#2f9e8f'] as [string, string], axis: '#5b667a' }
    : { speed: ['#ff9a63', '#e8551f'] as [string, string], alt: ['#5fc4ae', '#2f9e8f'] as [string, string], axis: '#98a0af' };
  const speedData = useMemo(() => series.filter((p) => p.s != null).map((p) => ({ x: p.t, y: p.s! })), [series]);
  const altData = useMemo(() => series.filter((p) => p.a != null).map((p) => ({ x: p.t, y: p.a! })), [series]);

  const weekday = WEEKDAY[new Date(ride.date.replace(' ', 'T')).getDay()];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="rdcard" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="骑行详情">
        <button className="rdcard__close" onClick={onClose} aria-label="关闭">✕</button>
        <div className="rdcard__head">
          <div className="rdcard__icon">🐾</div>
          <div className="rdcard__headmain">
            <div className="rdcard__titleline">
              {editing ? (
                <input
                  className="rdcard__titleinput"
                  value={draft}
                  autoFocus
                  maxLength={60}
                  disabled={busy}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveTitle();
                    if (e.key === 'Escape') setEditing(false);
                  }}
                  onBlur={saveTitle}
                />
              ) : (
                <>
                  <span
                    className="rdcard__title rdcard__title-editable"
                    title={ride.demo ? '演示数据不支持改名' : '点击改名'}
                    onClick={() => !ride.demo && setEditing(true)}
                  >
                    {ride.title} · {weekday}
                  </span>
                  {ride.demo && <i className="rdcard__demobadge">演示数据</i>}
                </>
              )}
            </div>
            <div className="rdcard__sub">{ride.date} · {ride.device}{ride.city ? ` · ${ride.city}` : ''}</div>
          </div>
          <button className="rdcard__delete" title={ride.demo ? '删除演示数据' : '删除这条骑行'} disabled={busy} onClick={remove}>
            🗑
          </button>
        </div>

        <div className="rdcard__stats">
          <div><b>{ride.distanceKm.toFixed(2)}</b><span>距离 km</span></div>
          <div><b>{fmtDuration(ride.movingTimeSec)}</b><span>记录时间</span></div>
          <div><b>{ride.avgSpeedKmh.toFixed(1)}</b><span>平均速度 km/h</span></div>
          <div><b>{ride.ascentM}</b><span>累计爬升 m</span></div>
          <div><b>{ride.calorie ?? '—'}</b><span>卡路里 kcal</span></div>
          <div><b>{ride.maxSpeedKmh?.toFixed(1) ?? '—'}</b><span>最高速度 km/h</span></div>
        </div>

        {track.length > 1 && <TrackMiniMap track={track} theme={theme} />}

        <div className="rdcard__charts">
          {speedData.length > 1 && (
            <AreaChart data={speedData} tMax={tMax} colors={colors.speed} axis={colors.axis} title="速度" unit="km/h" height={110} replayActive={false} />
          )}
          {altData.length > 1 && (
            <AreaChart data={altData} tMax={tMax} colors={colors.alt} axis={colors.axis} title="海拔" unit="m" height={100} replayActive={false} />
          )}
          {seriesErr && <div className="rdcard__hint">逐秒序列缺失（旧数据），图表不可用</div>}
        </div>

        <div className="rdcard__actions">
          <button onClick={() => exportGpx(ride, track, series)}>⬇ 导出 GPX</button>
          <button onClick={() => exportShareCard(ride, track, theme)}>🖼 分享卡片</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 骑行历史页 ---------------- */

export function HistoryPage({
  rides, tracks, theme, onDataChanged,
}: {
  rides: RideInfo[];
  tracks: TrackFC | null;
  theme: 'night' | 'day';
  /** 上传/导入成功后通知壳层重新拉取列表与地图数据 */
  onDataChanged: () => void;
}) {
  const [detailId, setDetailId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const trackOf = (id: number) => tracks?.features.find((f) => f.properties.rideId === id)?.geometry.coordinates ?? [];
  const detailRide = detailId != null ? rides.find((r) => r.rideId === detailId) : undefined;

  const doUpload = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.fit')) {
      setUploadMsg({ ok: false, text: '请选择 .fit 文件' });
      return;
    }
    setUploading(true);
    setUploadMsg(null);
    try {
      const r = await uploadFit(file);
      setUploadMsg({ ok: true, text: `${r.replaced ? '已覆盖' : '已导入'} ${r.date} · ${r.distanceKm} km，列表已刷新` });
      onDataChanged();
    } catch (e) {
      setUploadMsg({ ok: false, text: String((e as Error).message) });
    } finally {
      setUploading(false);
    }
  };

  const isStatic = DATA_MODE === 'static';
  const sorted = [...rides].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div className="history">
      <PageDecor />
      <header className="history__head">
        <div>
          <h2>骑行历史</h2>
          <p className="history__sub">每一次出门，都是给这座城市的打卡</p>
        </div>
        {!isStatic && (
          <label
            className={`fitdrop${dragOver ? ' drag' : ''}${uploading ? ' busy' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) doUpload(f);
            }}
          >
            <input
              type="file"
              accept=".fit"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) doUpload(f);
                e.currentTarget.value = '';
              }}
            />
            {uploading ? '解析入库中…' : '⬆ 导入 FIT'}
          </label>
        )}
      </header>
      {uploadMsg && <div className={`history__msg ${uploadMsg.ok ? 'ok' : 'err'}`}>{uploadMsg.text}</div>}
      {isStatic && <div className="history__msg err">静态演示模式不支持导入与同步，请使用自有后端部署</div>}

      <Heatmap rides={rides} />

      <div className="history__list">
        {sorted.length === 0 && <div className="history__empty">还没有骑行记录，去骑一趟，或导入一个 FIT 试试 🐾</div>}
        {sorted.map((r) => {
          const wd = WEEKDAY[new Date(r.date.replace(' ', 'T')).getDay()];
          return (
            <button key={r.rideId} className="ride-row" onClick={() => setDetailId(r.rideId)}>
              <span className="ride-row__date">
                <b>{r.date.slice(8, 10)}</b>
                <i>{Number(r.date.slice(5, 7))}月{wd}</i>
              </span>
              <span className="ride-row__main">
                <span className="ride-row__title">
                  {r.title}
                  {r.demo && <i className="ride-row__demo">演示</i>}
                </span>
                <span className="ride-row__meta">
                  <b>{r.distanceKm.toFixed(1)} km</b> · {fmtDuration(r.movingTimeSec)} · {r.avgSpeedKmh.toFixed(1)} km/h · ↑{r.ascentM}m
                  {r.city ? ` · ${r.city}` : ''}
                </span>
              </span>
              <span className="ride-row__arrow">›</span>
            </button>
          );
        })}
      </div>

      {detailRide && (
        <RideDetailCard
          ride={detailRide}
          track={trackOf(detailRide.rideId)}
          theme={theme}
          onDataChanged={onDataChanged}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}
