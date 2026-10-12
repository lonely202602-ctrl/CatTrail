import { useCallback, useEffect, useState } from 'react';
import type { ClustersIndex, RideSeriesPoint, RidesIndex } from '@lonelycat/shared';
import {
  fetchClusters, fetchRidesIndex, fetchSeries, fetchTracks, getToken, clearToken, fetchMe,
  DATA_MODE, type TrackFC,
} from './data/adapter';
import { AuthPage } from './pages/AuthPage';
import RideMap from './map/RideMap';
import type { TrailTheme } from './map/mapStyle';
import SidePanel from './components/SidePanel';
import ActivityDrawer from './components/ActivityDrawer';
import { NavBar, type PageKey } from './components/NavBar';
import { HistoryPage } from './pages/HistoryPage';
import { SettingsPage } from './pages/SettingsPage';

type Theme = TrailTheme;

function initialTheme(): Theme {
  // 默认晨巡（白）；用户显式选过夜巡才用夜巡
  return (localStorage.getItem('cattrail-theme') as Theme) === 'night' ? 'night' : 'day';
}

export default function App() {
  const [index, setIndex] = useState<RidesIndex | null>(null);
  const [clusters, setClusters] = useState<ClustersIndex['clusters']>([]);
  const [tracks, setTracks] = useState<TrackFC | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [focusRideIds, setFocusRideIds] = useState<number[] | null>(null);
  /** 骑行回放：进度由这里统一驱动，地图光点与图表指针共享同一进度 */
  const [replayRide, setReplayRide] = useState<number | null>(null);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [seriesCache, setSeriesCache] = useState<Record<number, RideSeriesPoint[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<PageKey>('map');
  const [activeRegion, setActiveRegion] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  /** 服务端模式必须登录；静态演示模式免登录 */
  const [authed, setAuthed] = useState(() => DATA_MODE === 'static' ? true : !!getToken());

  // 数据加载（历史/设置页的操作完成后回调刷新，地图/热力图/列表共用一份数据）
  const loadData = useCallback(() => {
    Promise.all([fetchRidesIndex(), fetchTracks(), fetchClusters()])
      .then(([idx, fc, cls]) => {
        setIndex(idx);
        setTracks(fc);
        setClusters(cls.clusters);
        const latest = fc.features.at(-1)?.properties.rideId ?? null;
        setSelectedId(latest);
      })
      .catch((e) => setError(String((e as Error).message ?? e)))
      .finally(() => setTimeout(() => setLoading(false), 400));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('cattrail-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (DATA_MODE === 'static' || !getToken()) return;
    // 校验本地令牌是否仍有效（无效则清掉进入登录页）
    fetchMe()
      .then((me) => {
        setUsername(me.username);
        setAuthed(true);
      })
      .catch(() => {
        clearToken();
        setAuthed(false);
      });
  }, []);

  useEffect(() => {
    if (DATA_MODE !== 'static' && !authed) return;
    loadData();
  }, [loadData, authed]);

  // 切页时收起地图抽屉
  useEffect(() => {
    if (page !== 'map') setDetailId(null);
  }, [page]);

  const toggleTheme = () => {
    const root = document.documentElement;
    if (root.classList.contains('theme-fading')) return;
    root.classList.add('theme-fading');
    // 淡出 260ms → 换肤（底图重建在淡出掩护下进行）→ 停留一拍 → 淡入
    setTimeout(() => {
      setTheme((t) => (t === 'night' ? 'day' : 'night'));
      setTimeout(() => root.classList.remove('theme-fading'), 480);
    }, 260);
  };

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
  const detailTrack =
    detailId != null ? tracks?.features.find((f) => f.properties.rideId === detailId)?.geometry.coordinates ?? null : null;

  const startReplay = (rideId: number) => {
    // 再次点击 = 停止；回放期间抽屉保持打开，图表指针与地图光点同步
    // 进度由 RideMap 内部定时器驱动并写入 replayStore（避免高频 React 重渲染）
    setReplayRide((r) => (r === rideId ? null : rideId));
  };

  const clearFocus = () => {
    setFocusRideIds(null);
    setSelectedId(null);
    setSelectedClusterId(null);
  };

  // 调试/测试钩子（无副作用，方便浏览器控制台驱动）
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__cattrail = { openDetail, startReplay, focusRegion: setFocusRideIds };
  });

  if (DATA_MODE !== 'static' && !authed) {
    return (
      <AuthPage
        theme={theme}
        onAuthed={(name) => {
          setUsername(name);
          setAuthed(true);
          loadData();
        }}
      />
    );
  }

  return (
    <>
      {/* 地图页（切页不卸载，保留地图状态） */}
      <div className={`page page-map${page === 'map' ? ' active' : ''}`} aria-hidden={page !== 'map'}>
        <RideMap
          tracks={tracks}
          clusters={clusters}
          theme={theme}
          selectedId={selectedId}
          selectedClusterId={selectedClusterId}
          focusRideIds={focusRideIds}
          replayRideId={replayRide}
          onReplayEnd={() => setReplayRide(null)}
          focusRideId={replayRide ?? detailId}
          focusIsReplay={replayRide != null}
          onSelect={(id) => {
            setActiveRegion(null);
            setSelectedId(id);
            setSelectedClusterId(null);
          }}
          onSelectCluster={(id) => {
            setActiveRegion(null);
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
          activeRegion={activeRegion}
          onSelect={(id) => {
            setActiveRegion(null);
            setSelectedId(id);
            setSelectedClusterId(null);
          }}
          onSelectCluster={(id) => {
            setActiveRegion(null);
            setSelectedClusterId(id);
            setSelectedId(null);
          }}
          onFocusRegion={(key, ids) => {
            setActiveRegion(key);
            setFocusRideIds(ids);
            setSelectedId(null);
            setSelectedClusterId(null);
          }}
        />
      </div>

      {/* 骑行历史页 */}
      <div className={`page page-history${page === 'history' ? ' active' : ''}`} aria-hidden={page !== 'history'}>
        <HistoryPage
          rides={rides}
          tracks={tracks}
          theme={theme}
          onDataChanged={loadData}
        />
      </div>

      {/* 设置页 */}
      <div className={`page page-settings${page === 'settings' ? ' active' : ''}`} aria-hidden={page !== 'settings'}>
        <SettingsPage username={username} onDataChanged={loadData} />
      </div>

      <NavBar page={page} onChange={setPage} />

      <button
        className="theme-toggle"
        onClick={toggleTheme}
        title={theme === 'night' ? '切换到晨巡' : '切换到夜巡'}
      >
        {theme === 'night' ? '☀️' : '🌙'}
      </button>

      {detailId != null && detailRide && (
        <ActivityDrawer
          ride={detailRide}
          series={seriesCache[detailId] ?? []}
          theme={theme}
          track={detailTrack ?? []}
          onToggleReplay={() => detailId != null && startReplay(detailId)}
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
