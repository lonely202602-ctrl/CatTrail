import { useRef } from 'react';
import type { RideInfo, RouteCluster } from '@lonelycat/shared';

interface Props {
  rides: RideInfo[];
  clusters: RouteCluster[];
  totalKm: number;
  totalAscentM: number;
  selectedId: number | null;
  selectedClusterId: string | null;
  onSelect: (id: number) => void;
  onSelectCluster: (id: string) => void;
}

export default function SidePanel({
  rides, clusters, totalKm, totalAscentM, selectedId, selectedClusterId, onSelect, onSelectCluster,
}: Props) {
  const ridesRef = useRef<HTMLDivElement>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout>>();

  // 滚动时滚动条淡入，停止 900ms 后淡出
  const onRidesScroll = () => {
    const el = ridesRef.current;
    if (!el) return;
    el.classList.add('is-scrolling');
    clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => el.classList.remove('is-scrolling'), 900);
  };

  return (
    <aside className="panel">
      <div className="panel__brand">
        <img className="brand-logo" src="/brand/logo-icon.png" alt="CatTrail" />
        <div>
          <h1>
            猫踪<span className="en">CAT TRAIL</span>
          </h1>
          <div className="sub">你的每一次骑行，都是这座城市里猫的踪迹</div>
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <b>{totalKm.toFixed(0)}</b>
          <span>总里程 KM</span>
        </div>
        <div className="stat">
          <b>{rides.length}</b>
          <span>骑行次数</span>
        </div>
        <div className="stat">
          <b>{clusters.length}</b>
          <span>猫 径</span>
        </div>
      </div>

      {clusters.length > 0 && (
        <div className="rides clusters">
          <div className="rides__title">猫 径 · 反 复 巡 游 的 路</div>
          {clusters.map((c, i) => (
            <div
              key={c.id}
              className={`cluster-item${selectedClusterId === c.id ? ' active' : ''}`}
              onClick={() => onSelectCluster(c.id)}
            >
              <span className="paw">🐾</span>
              <div className="info">
                <div className="name">猫径 #{i + 1}</div>
                <div className="meta">
                  骑过 <b>{c.count}</b> 次 · 最佳 <b>{c.bestAvgSpeedKmh.toFixed(1)} km/h</b>
                </div>
              </div>
              <span className="arrow">→</span>
            </div>
          ))}
        </div>
      )}

      <div className="rides rides-capped" ref={ridesRef} onScroll={onRidesScroll}>
        <div className="rides__title">足 迹 巡 回</div>
        {rides.map((r) => (
          <div
            key={r.rideId}
            className={`ride-item${selectedId === r.rideId ? ' active' : ''}`}
            onClick={() => onSelect(r.rideId)}
          >
            <span className="dot" />
            <div className="info">
              <div className="date">{r.date.slice(0, 16)}</div>
              <div className="meta">
                <b>{r.distanceKm.toFixed(1)} km</b>
                <span>{r.avgSpeedKmh.toFixed(1)} km/h · ↑{r.ascentM}m</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="panel__foot">
        <span>IGPSPORT BSC200S</span>
        <span className="mode">● {import.meta.env.VITE_DATA_MODE === 'static' ? '静态演示' : '在线同步'}</span>
      </div>
    </aside>
  );
}
