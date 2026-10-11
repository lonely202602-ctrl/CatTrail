import { useEffect, useState } from 'react';
import type { RideInfo, RidesIndex } from '@lonelycat/shared';
import { fetchRidesIndex, fetchTracks, type TrackFC } from './data/adapter';
import RideMap from './map/RideMap';
import SidePanel from './components/SidePanel';

export default function App() {
  const [index, setIndex] = useState<RidesIndex | null>(null);
  const [tracks, setTracks] = useState<TrackFC | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchRidesIndex(), fetchTracks()])
      .then(([idx, fc]) => {
        setIndex(idx);
        setTracks(fc);
        const latest = fc.features.at(-1)?.properties.rideId ?? null;
        if (latest != null) setSelectedId(latest);
      })
      .catch((e) => setError(String((e as Error).message ?? e)))
      .finally(() => setTimeout(() => setLoading(false), 400));
  }, []);

  const rides: RideInfo[] = index?.rides ?? [];

  return (
    <>
      <RideMap tracks={tracks} selectedId={selectedId} onSelect={setSelectedId} />
      <SidePanel
        rides={rides}
        totalKm={index?.totalKm ?? 0}
        totalAscentM={index?.totalAscentM ?? 0}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
      {(loading || error) && (
        <div className="loading" style={{ opacity: loading ? 1 : 0, pointerEvents: 'none' }}>
          {error ? `⚠ ${error}` : '🐾 猫的踪迹正在汇聚…'}
        </div>
      )}
    </>
  );
}
