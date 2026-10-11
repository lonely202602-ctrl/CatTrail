/**
 * 回放进度外部store：地图光点（60fps 命令式更新）与图表指针（React 订阅，节流 ~11Hz）
 * 共享同一进度，避免高频 React 全树重渲染造成的卡顿。
 */
export interface ReplayState {
  rideId: number | null;
  progress: number;
}

let state: ReplayState = { rideId: null, progress: 0 };
const subs = new Set<() => void>();
let lastNotify = 0;

function emit() {
  subs.forEach((fn) => fn());
}

export const replayStore = {
  get: (): ReplayState => state,
  subscribe(fn: () => void) {
    subs.add(fn);
    return () => {
      subs.delete(fn);
    };
  },
  start(rideId: number) {
    state = { rideId, progress: 0 };
    emit();
  },
  /** 地图 RAF 每帧调用；React 通知节流到 ~11Hz（结束时立即通知一次） */
  update(rideId: number, progress: number) {
    state = { rideId, progress };
    const now = performance.now();
    if (progress >= 1 || now - lastNotify > 90) {
      lastNotify = now;
      emit();
    }
  },
  stop() {
    state = { rideId: null, progress: 0 };
    emit();
  },
};
