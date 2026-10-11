import type { RideInfo } from '@lonelycat/shared';

interface Props {
  rides: RideInfo[];
  totalKm: number;
  totalAscentM: number;
  selectedId: number | null;
  onSelect: (id: number) => void;
}

export default function SidePanel({ rides, totalKm, totalAscentM, selectedId, onSelect }: Props) {
  return (
    <aside className="panel">
      <div className="panel__brand">
        <h1>
          <span className="cat">🐈‍⬛</span> 猫踪
          <span className="en">CAT TRAIL</span>
        </h1>
        <div className="sub">你的每一次骑行，都是这座城市里猫的踪迹</div>
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
          <b>{totalAscentM.toFixed(0)}</b>
          <span>总爬升 M</span>
        </div>
      </div>

      <div className="rides">
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
