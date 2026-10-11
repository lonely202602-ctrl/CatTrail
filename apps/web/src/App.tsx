import { useEffect, useState } from 'react';
import type { ClustersIndex, RideSeriesPoint, RidesIndex } from '@lonelycat/shared';
import { fetchClusters, fetchRidesIndex, fetchSeries, fetchTracks, type TrackFC } from './data/adapter';
import RideMap from './map/RideMap';
import type { TrailTheme } from './map/mapStyle';
import SidePanel from './components/SidePanel';
import ActivityDrawer from './components/ActivityDrawer';

type Theme = TrailTheme;

function initialTheme(): Theme {
  return (localStorage.getItem('cattrail-theme') as Theme) === 'day' ? 'day' : 'night';
}

export default function App() {
  const [index, setIndex] = useState<RidesIndex | null>(null);
  const [clusters, setClusters] = useState<ClustersIndex['clusters']>([]);
  const [tracks, setTracks] = useState<TrackFC | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [seriesCache, setSeriesCache] = useState<Record<number, RideSeriesPoint[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('cattrail-theme', theme);
  }, [theme]);

  useEffect(() => {
    Promise.all([fetchRidesIndex(), fetchTracks(), fetchClusters()])
      .then(([idx, fc, cls]) => {
        setIndex(idx);
        setTracks(fc);
        setClusters(cls.clusters);
        const latest = fc.features.at(-1)?.properties.rideId ?? null;
        if (latest != null) setSelectedId(latest);
      })
      .catch((e) => setError(String((e as Error).message ?? e)))
      .finally(() => setTimeout(() => setLoading(false), 400));
  }, []);

  // 打开抽屉时按需拉取逐秒序列
  const openDetail = (rideId: number) => {
    setDetailId(rideId);
    if (!seriesCache[rideId]) {
      fetchSeries(rideId)
        .then((series) => setSeriesCache((c) => ({ ...c, [rideId]: series })))
        .catch((e) => setError(String((e as Error).message ?? e)));
    }
  };

  const rides = index?.rides ?? [];
  const detailRide = detailId != null ? rides.find((r) => r.rideId === detailId) : undefined;

  return (
    <>
      <RideMap
        tracks={tracks}
        clusters={clusters}
        theme={theme}
        selectedId={selectedId}
        selectedClusterId={selectedClusterId}
        onSelect={(id) => {
          setSelectedId(id);
          setSelectedClusterId(null);
        }}
        onSelectCluster={(id) => {
          setSelectedClusterId(id || null);
          setSelectedId(null);
        }}
        onOpenDetail={openDetail}
      />

      <SidePanel
        rides={rides}
        clusters={clusters}
        totalKm={index?.totalKm ?? 0}
        totalAscentM={index?.totalAscentM ?? 0}
        selectedId={selectedId}
        selectedClusterId={selectedClusterId}
        onSelect={(id) => {
          setSelectedId(id);
          setSelectedClusterId(null);
        }}
        onSelectCluster={(id) => {
          setSelectedClusterId(id);
          setSelectedId(null);
        }}
      />

      <button
        className="theme-toggle"
        onClick={() => setTheme((t) => (t === 'night' ? 'day' : 'night'))}
        title={theme === 'night' ? '切换到晨巡' : '切换到夜巡'}
      >
        {theme === 'night' ? '☀️' : '🌙'}
      </button>

      {detailId != null && detailRide && (
        <ActivityDrawer
          ride={detailRide}
          series={seriesCache[detailId] ?? []}
          theme={theme}
          onClose={() => setDetailId(null)}
        />
      )}

      {(loading || error) && (
        <div className="loading" style={{ opacity: loading ? 1 : 0, pointerEvents: 'none' }}>
          {error ? `⚠ ${error}` : '🐾 猫的踪迹正在汇聚…'}
        </div>
      )}
    </>
  );
}
