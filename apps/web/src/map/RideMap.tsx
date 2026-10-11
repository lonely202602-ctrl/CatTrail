/** MapLibre 地图封装：夜巡底图 + 轨迹发光图层 + 选中飞行 + 点击弹窗 */
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { buildNightCatStyle } from './mapStyle';
import type { TrackFC } from '../data/adapter';

interface Props {
  tracks: TrackFC | null;
  selectedId: number | null;
  onSelect: (rideId: number) => void;
}

export default function RideMap({ tracks, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const tracksRef = useRef<TrackFC | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // 初始化地图（一次）
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildNightCatStyle(),
      center: [113.38, 23.07],
      zoom: 11,
      attributionControl: false,
      renderWorldCopies: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.dragPan.enable({ inertia: 400 });
    (window as unknown as { __map?: maplibregl.Map }).__map = map;
    (window as unknown as { __mapErrors: string[] }).__mapErrors = [];
    map.on('error', (e) => {
      (window as unknown as { __mapErrors: string[] }).__mapErrors.push(
        String((e as { error?: Error }).error?.message ?? e),
      );
    });
    mapRef.current = map;

    map.on('load', () => {
      if (tracksRef.current) addTracks(map, tracksRef.current, onSelectRef.current);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 数据到达后挂轨迹
  useEffect(() => {
    tracksRef.current = tracks;
    const map = mapRef.current;
    if (map && tracks && map.isStyleLoaded()) addTracks(map, tracks, onSelectRef.current);
  }, [tracks]);

  // 选中骑行 → 平滑飞行
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !tracks || selectedId == null) return;
    const f = tracks.features.find((x) => x.properties.rideId === selectedId);
    if (!f || f.geometry.coordinates.length === 0) return;
    const b = new maplibregl.LngLatBounds(f.geometry.coordinates[0], f.geometry.coordinates[0]);
    f.geometry.coordinates.forEach((c) => b.extend(c));
    map.fitBounds(b, { padding: { top: 100, bottom: 100, left: 400, right: 100 }, duration: 1600, essential: true });
  }, [selectedId, tracks]);

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />;
}

function addTracks(map: maplibregl.Map, fc: TrackFC, onSelect: (id: number) => void) {
  if (map.getSource('tracks')) {
    (map.getSource('tracks') as maplibregl.GeoJSONSource).setData(fc);
    return;
  }
  map.addSource('tracks', { type: 'geojson', data: fc });

  // 轨迹描线动画：line-dasharray 循环，路线像被“骑”出来
  const dashSeq = [
    [0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1],
    [2.5, 4, 0.5], [3, 4, 0], [0, 0.5, 4], [0, 1, 4], [0, 1.5, 4], [0, 2, 4], [0, 2.5, 4], [0, 3, 4], [0, 3.5, 4],
  ];
  let step = 0;
  // @ts-expect-error dasharray 动画序列
  const dashTimer = setInterval(() => {
    step = (step + 1) % dashSeq.length;
    if (map.getLayer('track-draw')) map.setPaintProperty('track-draw', 'line-dasharray', dashSeq[step]);
  }, 60);
  map.once('remove', () => clearInterval(dashTimer));

  map.addLayer({
    id: 'track-glow',
    type: 'line',
    source: 'tracks',
    paint: { 'line-color': '#ff6b35', 'line-width': 12, 'line-opacity': 0.22, 'line-blur': 4 },
  });
  map.addLayer({
    id: 'track-halo',
    type: 'line',
    source: 'tracks',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ff8a5c', 'line-width': 5, 'line-opacity': 0.45 },
  });
  map.addLayer({
    id: 'track-draw',
    type: 'line',
    source: 'tracks',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#ff6b35',
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 14, 4],
      'line-opacity': 0.98,
    },
  });

  // 起点猫爪标记（canvas 现场生成，无外部图片资源）
  map.loadImage(pawDataUrl(), (err, image) => {
    if (err || !image || map.hasImage('paw')) return;
    map.addImage('paw', image);
    const starts = {
      type: 'FeatureCollection',
      features: fc.features.map((f) => ({
        type: 'Feature',
        properties: { rideId: f.properties.rideId },
        geometry: { type: 'Point', coordinates: f.geometry.coordinates[0] },
      })),
    } as GeoJSON.FeatureCollection;
    map.addLayer({
      id: 'start-paw',
      type: 'symbol',
      source: { type: 'geojson', data: starts },
      layout: { 'image': 'paw', 'icon-size': 0.45, 'icon-allow-overlap': true },
    });
  });

  // 交互
  ['track-draw', 'track-halo', 'track-glow'].forEach((id) => {
    map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', id, () => (map.getCanvas().style.cursor = ''));
    map.on('click', id, (e) => {
      const p = e.features?.[0]?.properties;
      if (!p) return;
      onSelect(Number(p.rideId));
      showPopup(map, e.lngLat, p);
    });
  });
}

function showPopup(map: maplibregl.Map, lngLat: maplibregl.LngLat, p: Record<string, unknown>) {
  popupRef.current?.remove();
  popupRef.current = new maplibregl.Popup({ closeButton: false, maxWidth: '240px' })
    .setLngLat(lngLat)
    .setHTML(
      `<b>🐾 ${p.title}</b><br>` +
        `${p.date}<br>` +
        `里程 <b>${p.distanceKm} km</b> · 爬升 <b>${p.ascentM} m</b><br>` +
        `均速 <b>${p.avgSpeedKmh} km/h</b> · ${p.device}`,
    )
    .addTo(map);
}

/** 程序生成的猫爪印贴图（64×64，主题橙） */
function pawDataUrl(): string {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ff6b35';
  ctx.shadowColor = 'rgba(255,107,53,.6)';
  ctx.shadowBlur = 6;
  const ellipse = (x: number, y: number, rx: number, ry: number, rot = 0) => {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
    ctx.fill();
  };
  ellipse(32, 42, 13, 11);            // 掌
  ellipse(16, 24, 6.5, 7.5, -0.25);   // 左趾
  ellipse(32, 17, 6.5, 7.5);          // 中趾
  ellipse(48, 24, 6.5, 7.5, 0.25);    // 右趾
  return c.toDataURL();
}
