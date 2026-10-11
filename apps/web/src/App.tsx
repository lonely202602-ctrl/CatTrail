import { useEffect, useState } from 'react';
import type { ClustersIndex, RideInfo, RidesIndex } from '@lonelycat/shared';
import { fetchClusters, fetchRidesIndex, fetchTracks, type TrackFC } from './data/adapter';
import RideMap from './map/RideMap';
import SidePanel from './components/SidePanel';

export default function App() {
  const [index, setIndex] = useState<RidesIndex | null>(null);
  const [clusters, setClusters] = useState<ClustersIndex['clusters']>([]);
  const [tracks, setTracks] = useState<TrackFC | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  const rides: RideInfo[] = index?.rides ?? [];

  return (
    <>
      <RideMap
        tracks={tracks}
        clusters={clusters}
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
      {(loading || error) && (
        <div className="loading" style={{ opacity: loading ? 1 : 0, pointerEvents: 'none' }}>
          {error ? `⚠ ${error}` : '🐾 猫的踪迹正在汇聚…'}
        </div>
      )}
    </>
  );
}
