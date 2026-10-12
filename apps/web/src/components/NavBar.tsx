/** 悬浮玻璃导航栏：左端品牌 logo + 三页切换（激活高亮平滑滑动，iOS 质感毛玻璃 pill） */
import { useCallback, useEffect, useRef, useState } from 'react';

const TABS = [
  { key: 'map', label: '地图', icon: 'M1 3.5 6 1l5 2.5L16 1v11.5L11 15l-5-2.5L1 15Zm5 2.3v8m5-8v8' },
  { key: 'history', label: '骑行历史', icon: 'M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1Zm0 3v4l3 2' },
  { key: 'settings', label: '设置', icon: 'M8 5.5A2.5 2.5 0 1 1 8 10.5 2.5 2.5 0 0 1 8 5.5Zm6 2.5-.1 1.2 1.4 1.1-1 1.7-1.7-.6-1 .7-.3 1.8H9.7L9.4 12l-1-.7-1.7.6-1-1.7 1.4-1.1L7 8l-.1-1.2L5.5 5.7l1-1.7 1.7.6 1-.7.3-1.8h1.9l.3 1.8 1 .7 1.7-.6 1 1.7-1.4 1.1Z' },
] as const;

export type PageKey = (typeof TABS)[number]['key'];

export function NavBar({ page, onChange }: { page: PageKey; onChange: (p: PageKey) => void }) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);

  const measure = useCallback(() => {
    const i = TABS.findIndex((t) => t.key === page);
    const el = tabRefs.current[i];
    if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth });
  }, [page]);

  useEffect(() => {
    measure();
    // 字体加载完成/窗口变化都可能改变按钮宽度
    document.fonts?.ready.then(measure).catch(() => undefined);
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  return (
    <nav className="navbar" aria-label="主导航">
      <img className="navbar__logo" src="/brand/logo-icon.png?v=2" alt="猫踪 CatTrail" />
      <i className="navbar__sep" aria-hidden />
      <div className="navbar__tabs">
        <span
          className="navbar__thumb"
          style={thumb ? { width: thumb.width, transform: `translateX(${thumb.left}px)` } : { opacity: 0 }}
          aria-hidden
        />
        {TABS.map((t, i) => (
          <button
            key={t.key}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            className={`navbar__item${page === t.key ? ' active' : ''}`}
            onClick={() => onChange(t.key)}
            aria-current={page === t.key ? 'page' : undefined}
          >
            <svg viewBox="0 0 17 16" width="17" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d={t.icon} />
            </svg>
            <span>{t.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
