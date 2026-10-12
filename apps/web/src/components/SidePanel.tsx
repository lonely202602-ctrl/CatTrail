import { useMemo, useRef } from 'react';
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
  onFocusRegion: (rideIds: number[]) => void;
}

export default function SidePanel({
  rides, clusters, totalKm, totalAscentM, selectedId, selectedClusterId, onSelect, onSelectCluster, onFocusRegion,
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

  // 省/市 → 骑行分组（同步时离线反查所得）
  const regionGroups = useMemo(() => {
    const byProv = new Map<string, Map<string, number[]>>();
    for (const r of rides) {
      const prov = r.province || '未知区域';
      const city = r.city || prov;
      if (!byProv.has(prov)) byProv.set(prov, new Map());
      const cities = byProv.get(prov)!;
      if (!cities.has(city)) cities.set(city, []);
      cities.get(city)!.push(r.rideId);
    }
    return Array.from(byProv.entries()).map(([prov, cities]) => ({
      prov,
      cities: Array.from(cities.entries()).map(([city, ids]) => ({ city, ids })),
    }));
  }, [rides]);

  return (
    <aside className="panel">
      <div className="panel__brand">
        <img className="brand-logo" src="/brand/logo-icon.png?v=3" alt="CatTrail" />
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

      <div className="regions">
        <div className="rides__title">定 位</div>
        <div className="region-card" onClick={() => onFocusRegion(rides.map((r) => r.rideId))}>
          <span className="region-emoji">🐾</span>
          <div className="info">
            <div className="name">全国视野</div>
            <div className="meta">所有巡游轨迹一图尽览</div>
          </div>
          <span className="count-pill">{rides.length}</span>
        </div>
        {regionGroups.map((g) =>
          g.cities.map((c) => (
            <div key={`${g.prov}-${c.city}`} className="region-card" onClick={() => onFocusRegion(c.ids)}>
              <span className="region-emoji">📍</span>
              <div className="info">
                <div className="name">{g.prov}</div>
                <div className="meta">{c.city}</div>
              </div>
              <span className="count-pill">{c.ids.length}</span>
            </div>
          )),
        )}
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
