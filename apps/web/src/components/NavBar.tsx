/** 悬浮玻璃导航栏：地图 / 骑行历史 / 设置 三页切换（iOS 质感毛玻璃 pill） */

const TABS = [
  { key: 'map', label: '地图', icon: 'M1 3.5 6 1l5 2.5L16 1v11.5L11 15l-5-2.5L1 15Zm5 2.3v8m5-8v8' },
  { key: 'history', label: '骑行历史', icon: 'M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1Zm0 3v4l3 2' },
  { key: 'settings', label: '设置', icon: 'M8 5.5A2.5 2.5 0 1 1 8 10.5 2.5 2.5 0 0 1 8 5.5Zm6 2.5-.1 1.2 1.4 1.1-1 1.7-1.7-.6-1 .7-.3 1.8H9.7L9.4 12l-1-.7-1.7.6-1-1.7 1.4-1.1L7 8l-.1-1.2L5.5 5.7l1-1.7 1.7.6 1-.7.3-1.8h1.9l.3 1.8 1 .7 1.7-.6 1 1.7-1.4 1.1Z' },
] as const;

export type PageKey = (typeof TABS)[number]['key'];

export function NavBar({ page, onChange }: { page: PageKey; onChange: (p: PageKey) => void }) {
  return (
    <nav className="navbar" aria-label="主导航">
      {TABS.map((t) => (
        <button
          key={t.key}
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
    </nav>
  );
}
