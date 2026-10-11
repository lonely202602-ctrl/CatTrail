/** MapLibre 地图封装：主题化底图 + 渐进描线动画 + 历史小卡片 + 双击打开轨迹分析 */
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { buildStyle, trailPalette, type TrailTheme } from './mapStyle';
import type { RouteCluster } from '@lonelycat/shared';
import type { TrackFC } from '../data/adapter';
import { replayStore } from '../lib/replayStore';

interface Props {
  tracks: TrackFC | null;
  clusters: RouteCluster[];
  theme: TrailTheme;
  selectedId: number | null;
  selectedClusterId: string | null;
  /** 定位面板聚焦的骑行集合（飞过去） */
  focusRideIds: number[] | null;
  /** 骑行回放的线路 id（null = 停止）；进度由内部 RAF 写入 replayStore */
  replayRideId: number | null;
  onReplayEnd: () => void;
  /** 当前聚焦的线路（回放中或抽屉查看中）：其余线路淡化突出主体 */
  focusRideId: number | null;
  focusIsReplay: boolean;
  onSelect: (rideId: number) => void;
  onSelectCluster: (clusterId: string) => void;
  onOpenDetail: (rideId: number) => void;
}

let opacityAnimSeq = 0;

export default function RideMap({
  tracks, clusters, theme, selectedId, selectedClusterId, focusRideIds, replayRideId, onReplayEnd, focusRideId, focusIsReplay, onSelect, onSelectCluster, onOpenDetail,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const tracksRef = useRef<TrackFC | null>(null);
  const clustersRef = useRef<RouteCluster[]>(clusters);
  const selectedClusterRef = useRef<string | null>(selectedClusterId);
  const replayProgressRef = useRef(0);
  const handlers = useRef({ onSelect, onSelectCluster, onOpenDetail, theme });
  handlers.current = { onSelect, onSelectCluster, onOpenDetail, theme };
  const markerRef = useRef<maplibregl.Marker | null>(null);
  tracksRef.current = tracks;
  clustersRef.current = clusters;
  selectedClusterRef.current = selectedClusterId;

  // 初始化地图（一次）
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildStyle(handlers.current.theme),
      center: [113.38, 23.07],
      zoom: 11,
      attributionControl: false,
      renderWorldCopies: false,
    });
    map.doubleClickZoom.disable(); // 双击留给「轨迹分析」
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    (window as unknown as { __map?: maplibregl.Map }).__map = map;
    (window as unknown as { __mapErrors: string[] }).__mapErrors = [];
    map.on('error', (e) => {
      (window as unknown as { __mapErrors: string[] }).__mapErrors.push(
        String((e as { error?: Error }).error?.message ?? e),
      );
    });
    mapRef.current = map;

    map.on('load', () => {
      if (tracksRef.current) mountTracks(map, tracksRef.current);
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
    if (map && tracks && map.isStyleLoaded()) mountTracks(map, tracks);
  }, [tracks]);

  // 主题切换 → 底图淡出 → 重建样式并重挂轨迹 → 淡入（换肤时路线重新“骑”一遍）
  useEffect(() => {
    const map = mapRef.current;
    const el = containerRef.current;
    if (!map || !el || !map.loaded()) return;
    el.classList.add('map-fading');
    map.setStyle(buildStyle(theme), { diff: false });
    map.once('style.load', () => {
      if (tracksRef.current) mountTracks(map, tracksRef.current);
      setTimeout(() => el.classList.remove('map-fading'), 300);
    });
  }, [theme]);


  // 聚焦模式：查看/回放某条线路时，其余线路大幅淡化
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => applyFocusDim(map, focusRideId, focusIsReplay, selectedClusterId, clustersRef.current);
    waitStyleReady(map, apply);
  }, [focusRideId, focusIsReplay, theme, tracks, selectedClusterId, clusters]);

  // 选中骑行 → 平滑飞行
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !tracks || selectedId == null) return;
    const f = tracks.features.find((x) => x.properties.rideId === selectedId);
    if (!f || f.geometry.coordinates.length === 0) return;
    flyToBounds(map, [f]);
  }, [selectedId, tracks]);

  // 选中猫径 → 高亮整组轨迹 + 覆盖全部线路飞行
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      applyFocusDim(map, focusRideId, focusIsReplay, selectedClusterId, clustersRef.current);
      if (selectedClusterId != null) {
        const ids = clustersRef.current.find((c) => c.id === selectedClusterId)?.rideIds ?? [];
        const fs = tracksRef.current?.features.filter((f) => ids.includes(f.properties.rideId)) ?? [];
        if (fs.length > 0) flyToBounds(map, fs);
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [selectedClusterId, clusters, tracks]);


  // 骑行回放：RAF 命令式驱动（60fps 渐进绘制），进度写入 store 供图表指针订阅；
  // 自然播完后保留完整亮线（恢复原貌），中途停止才隐藏
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !tracks) return;
    let raf = 0;
    let stopped = false;

    const hideReplay = () => {
      markerRef.current?.remove();
      markerRef.current = null;
      if (map.getSource('replay-line')) {
        (map.getSource('replay-line') as maplibregl.GeoJSONSource)?.setData({
          type: 'FeatureCollection',
          features: [],
        });
      }
    };

    const begin = () => {
      if (stopped) return;
      if (replayRideId == null) {
        // 播完自然结束：保留完整亮线；中途手动停止：隐藏
        if (replayProgressRef.current >= 0.999) {
          const f = tracks.features.find((x) => x.properties.rideId === replayRideId);
          if (f) {
            const src = ensureReplayLayers(map, handlers.current.theme);
            src?.setData({
              type: 'FeatureCollection',
              features: [
                { type: 'Feature', properties: f.properties, geometry: { type: 'LineString', coordinates: f.geometry.coordinates } },
              ],
            });
          }
        } else {
          hideReplay();
        }
        return;
      }
      const f = tracks.features.find((x) => x.properties.rideId === replayRideId);
      if (!f || f.geometry.coordinates.length < 2) return;
      const coords = f.geometry.coordinates;
      const src = ensureReplayLayers(map, handlers.current.theme);
      if (!src) return;

      const C = trailPalette(handlers.current.theme);
      replayStore.start(replayRideId);
      const DUR = 20000;
      const start = performance.now();
      const tick = (now: number) => {
        if (stopped || !map.getSource('replay-line') || !markerRef.current) return;
        const p = Math.min(1, (now - start) / DUR);
        replayProgressRef.current = p;
        const idx = Math.min(coords.length - 1, Math.floor(p * (coords.length - 1)));
        markerRef.current.setLngLat(coords[idx]);
        src.setData({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: coords.slice(0, idx + 1) },
            },
          ],
        });
        replayStore.update(replayRideId, p);
        if (p < 1) {
          raf = requestAnimationFrame(tick);
        } else {
          // 播完：整条亮线保持（恢复原貌），1.2s 后通知 App 收尾
          src.setData({
            type: 'FeatureCollection',
            features: [
              { type: 'Feature', properties: f?.properties ?? {}, geometry: { type: 'LineString', coordinates: coords } },
            ],
          });
          setTimeout(() => {
            replayStore.stop();
            handlers.current.onReplayEnd();
          }, 1200);
        }
      };
      raf = requestAnimationFrame(tick);
    };

    // 样式未就绪时（慢网络）轮询等待，避免 "Style is not done loading" 异常
    waitStyleReady(map, begin);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [replayRideId, tracks]);

  /** 挂载轨迹图层 + 渐进描线动画 + 交互（幂等：换肤后重复调用安全） */
  function mountTracks(map: maplibregl.Map, fc: TrackFC) {
    const C = trailPalette(handlers.current.theme);

    if (!map.getSource('tracks')) {
      const stub = {
        type: 'FeatureCollection',
        features: fc.features.map((f) => ({
          type: 'Feature',
          properties: f.properties,
          geometry: { type: 'LineString', coordinates: f.geometry.coordinates.slice(0, 2) },
        })),
      } as TrackFC;
      map.addSource('tracks', { type: 'geojson', data: stub });

      // 透明宽命中层：点击/悬停判定走它（粗判定，细节由列表细分）
      map.addLayer({
        id: 'track-hit', type: 'line', source: 'tracks',
        paint: { 'line-color': C.track, 'line-opacity': 0, 'line-width': 30 },
      });

      map.addLayer({
        id: 'track-glow', type: 'line', source: 'tracks',
        paint: { 'line-color': C.track, 'line-width': 14, 'line-opacity': 0.28, 'line-blur': 5 },
      });
      map.addLayer({
        id: 'track-halo', type: 'line', source: 'tracks',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': C.halo, 'line-width': 5.5, 'line-opacity': 0.5 },
      });
      map.addLayer({
        id: 'track-draw', type: 'line', source: 'tracks',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': C.track,
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 14, 4],
          'line-opacity': 0.98,
        },
      });
      map.addLayer({
        id: 'cluster-hi', type: 'line', source: 'tracks',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        filter: ['in', ['get', 'rideId'], ['literal', []]],
        paint: { 'line-color': C.hi, 'line-width': 2.2, 'line-opacity': 0.95 },
      });

      // 渐进描线：路线被“骑”出来（尊重系统减少动态偏好；后台标签页也能完成）
      const src = map.getSource('tracks') as maplibregl.GeoJSONSource;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        src.setData(fc);
      } else {
        const start = performance.now();
        const DUR = 2200;
        const tick = () => {
          if (!map.getSource('tracks')) return; // 地图已销毁
          const p = Math.min(1, (performance.now() - start) / DUR);
          const e = 1 - Math.pow(1 - p, 3);
          src.setData({
            type: 'FeatureCollection',
            features: fc.features.map((f) => {
              const coords = f.geometry.coordinates;
              const k = Math.max(2, Math.round(coords.length * e));
              return {
                type: 'Feature' as const,
                properties: f.properties,
                geometry: { type: 'LineString' as const, coordinates: coords.slice(0, k) },
              };
            }),
          } as TrackFC);
          if (p < 1) setTimeout(tick, 16);
          else src.setData(fc);
        };
        setTimeout(tick, 16);
      }

      // 起点猫爪标记（canvas 现场生成）
      map.loadImage(pawDataUrl(), (err, image) => {
        if (err || !image || !map.getSource('tracks') || map.hasImage('paw')) return;
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
    } else {
      (map.getSource('tracks') as maplibregl.GeoJSONSource).setData(fc);
      if (map.getLayer('track-glow')) map.setPaintProperty('track-glow', 'line-color', C.track);
      if (map.getLayer('track-halo')) map.setPaintProperty('track-halo', 'line-color', C.halo);
      if (map.getLayer('track-draw')) map.setPaintProperty('track-draw', 'line-color', C.track);
      if (map.getLayer('cluster-hi')) map.setPaintProperty('cluster-hi', 'line-color', C.hi);
      return;
    }

    // 交互（走宽命中层）：单击 → 历史小卡片；双击 → 轨迹分析抽屉
    map.on('mouseenter', 'track-hit', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'track-hit', () => (map.getCanvas().style.cursor = ''));
    map.on('click', 'track-hit', (e) => {
      // 收集点击处全部线路（去重，保持命中顺序）
      const seen = new Set<number>();
      const rides: Array<Record<string, unknown>> = [];
      for (const f of e.features ?? []) {
        const id = Number(f.properties.rideId);
        if (!seen.has(id)) { seen.add(id); rides.push(f.properties); }
      }
      if (rides.length === 0) return;
      handlers.current.onSelect(Number(rides[0].rideId));
      showHistoryCardMulti(map, e.lngLat, rides, clustersRef.current, (id) => handlers.current.onOpenDetail(id));
    });
    map.on('dblclick', 'track-hit', (e) => {
      const p = e.features?.[0]?.properties;
      if (!p) return;
      e.preventDefault();
      handlers.current.onOpenDetail(Number(p.rideId));
    });
    map.on('click', (e) => {
      var hit = false;
      try { hit = m_queryHit(e.point); } catch (err) { hit = false; }
      if (!hit) handlers.current.onSelectCluster('');
    });
    function m_queryHit(point: maplibregl.PointLike) {
      return map.queryRenderedFeatures(point, { layers: ['track-hit'] }).length > 0;
    }
  }

  /** 聚焦模式：查看/回放某条线路时，其余线路大幅淡化；猫径高亮让位于聚焦主体 */
  /** 线路透明度平滑动画（RAF 插值，进入/退出聚焦都有过渡） */
  function animateTrackOpacity(map: maplibregl.Map, scale: number, dur: number) {
    const my = ++opacityAnimSeq;
    const bases: Array<[string, number]> = [['track-glow', 0.28], ['track-halo', 0.5], ['track-draw', 0.98]];
    const froms = bases.map(([layer, base]) => {
      let from = base;
      try { from = (map.getPaintProperty(layer, 'line-opacity') as number) ?? base; } catch { /* 样式未就绪 */ }
      return { layer, from, base };
    });
    const start = performance.now();
    const tick = (now: number) => {
      if (my !== opacityAnimSeq) return;
      const p = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - p, 2);
      for (const { layer, from, base } of froms) {
        if (!map.getLayer(layer)) continue;
        map.setPaintProperty(layer, 'line-opacity', from + (base * scale - from) * e);
      }
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /** 聚焦模式：查看/回放某条线路时，其余线路大幅淡化；查看中线路保持本体色 */
  function applyFocusDim(
    map: maplibregl.Map,
    focusRideId: number | null,
    focusIsReplay: boolean,
    selectedClusterId: string | null,
    cls: RouteCluster[],
  ) {
    const dim = focusRideId != null;
    // 猫径高亮：仅猫径筛选时使用；聚焦查看中线路保持本体色（不再叠加深色高亮）
    if (map.getLayer('cluster-hi')) {
      if (dim && focusIsReplay) {
        map.setFilter('cluster-hi', ['==', ['get', 'rideId'], -1]);
      } else if (dim) {
        map.setFilter('cluster-hi', ['==', ['get', 'rideId'], focusRideId]);
      } else {
        applyClusterFilter(map, selectedClusterId, cls);
      }
    }
    // 其余线路透明度平滑过渡（进入详情减到 8%，退出动画恢复）
    animateTrackOpacity(map, dim ? 0.08 : 1, 460);
  }

  function applyClusterFilter(map: maplibregl.Map, clusterId: string | number | null, cls: RouteCluster[]) {
    const src = map.getSource('tracks') as maplibregl.GeoJSONSource | undefined;
    if (!src || !map.getLayer('cluster-hi')) return;
    if (clusterId == null) {
      map.setFilter('cluster-hi', ['==', ['get', 'rideId'], -1]);
      return;
    }
    const ids = cls.find((c) => c.id === clusterId || c.rideIds.includes(Number(clusterId)))?.rideIds ?? [];
    map.setFilter('cluster-hi', ['in', ['get', 'rideId'], ['literal', ids]]);
  }

  /** 单击线路 → 历史骑行卡片（多线重叠时列出全部，点行看详情） */
  function showHistoryCardMulti(
    map: maplibregl.Map,
    lngLat: maplibregl.LngLat,
    rides: Array<Record<string, unknown>>,
    cls: RouteCluster[],
    openDetail: (id: number) => void,
  ) {
    const sorted = [...rides].sort((a, b) => String(b.date).localeCompare(String(a.date)));

    // 猫径归属：点击处线路属于猫径时，头部显示猫径、行内标最佳
    const clusterOf = (id: number) => cls.find((c) => c.rideIds.includes(id));
    const pawCluster = clusterOf(Number(sorted[0].rideId));
    const rows = sorted
      .map((prop) => ({ prop, id: Number(prop.rideId) }))
      .map(({ prop, id }) => {
        const cluster = clusterOf(id);
        const best = cluster ? cluster.bestRideId === id : false;
        return (
          `<div class="hist-row${best ? ' best' : ''}" data-open="${id}">` +
          `<span>${String(prop.date).slice(5, 16)}</span>` +
          `<b>${Number(prop.distanceKm).toFixed(1)} km</b>` +
          `<span>${Number(prop.avgSpeedKmh).toFixed(1)} km/h</span>` +
          `${best ? '<i>🏆</i>' : ''}</div>`
        );
      })
      .join('');

    const head =
      pawCluster && sorted.length === pawCluster.count
        ? `🐾 猫径 · 骑过 ${pawCluster.count} 次`
        : `🐾 足迹 · ${sorted.length} 条记录`;

    popupRef.current?.remove();
    const popup = new maplibregl.Popup({ closeButton: false, maxWidth: '300px' })
      .setLngLat(lngLat)
      .setHTML(
        `<div class="hist-card"><div class="hist-head">${head}</div>${rows}` +
          `<div class="hist-hint">点击行查看轨迹分析 · 双击线路直达</div></div>`,
      )
      .addTo(map);
    popup.getElement()?.querySelectorAll('[data-open]').forEach((el) => {
      el.addEventListener('click', () => openDetail(Number((el as HTMLElement).dataset.open)));
    });
    popupRef.current = popup;

    function propOf(id: number) {
      return tracksRef.current?.features.find((f) => f.properties.rideId === id)?.properties;
    }
  }

  return <div ref={containerRef} className="map-canvas" style={{ position: 'absolute', inset: 0 }} />;
}


/** 等待样式就绪后执行（轮询式，避免 once('load') 在已加载后注册永不触发） */
function waitStyleReady(map: maplibregl.Map, fn: () => void) {
  if (map.isStyleLoaded()) { fn(); return; }
  let tries = 0;
  const iv = setInterval(() => {
    tries++;
    if (map.isStyleLoaded() || map.loaded()) { clearInterval(iv); fn(); }
    else if (tries > 600) clearInterval(iv);
  }, 300);
}

/** 回放图层自愈：换肤/样式重建导致图层丢失时自动重建（幂等） */
function ensureReplayLayers(map: maplibregl.Map, theme: TrailTheme): maplibregl.GeoJSONSource | null {
  const C = trailPalette(theme);
  const main = ['interpolate', ['linear'], ['line-progress'], 0, C.track, 0.9, C.track, 1, C.hi];
  const glow = ['interpolate', ['linear'], ['line-progress'], 0, C.track, 0.85, C.track, 1, C.hi];
  if (!map.getSource('replay-line')) {
    map.addSource('replay-line', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      lineMetrics: true,
    });
  }
  if (!map.getLayer('replay-glow')) {
    map.addLayer({
      id: 'replay-glow',
      type: 'line',
      source: 'replay-line',
      layout: { 'line-cap': 'round' },
      paint: {
        'line-width': 13,
        'line-blur': 5,
        'line-opacity': 0.5,
        'line-gradient': glow,
      },
    });
  }
  if (!map.getLayer('replay-line')) {
    map.addLayer({
      id: 'replay-line',
      type: 'line',
      source: 'replay-line',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 14, 4.5],
        'line-gradient': main,
      },
    });
  }
  return map.getSource('replay-line') as maplibregl.GeoJSONSource | null;
}

function flyToBounds(map: maplibregl.Map, features: TrackFC['features'][]) {
  const b = new maplibregl.LngLatBounds();
  let n = 0;
  for (const f of features) {
    for (const c of f.geometry.coordinates) {
      b.extend(c);
      n++;
    }
  }
  if (n === 0) return;
  map.fitBounds(b, { padding: { top: 90, bottom: 90, left: 400, right: 460 }, duration: 1600, essential: true });
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
  ellipse(32, 42, 13, 11);
  ellipse(16, 24, 6.5, 7.5, -0.25);
  ellipse(32, 17, 6.5, 7.5);
  ellipse(48, 24, 6.5, 7.5, 0.25);
  return c.toDataURL();
}
