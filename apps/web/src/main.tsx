import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/theme.css';

// 启动期错误直接打到页面上（便于无控制台环境排查）
window.addEventListener('error', (e) => {
  const el = document.getElementById('root');
  if (el && el.children.length === 0) {
    el.textContent = '⚠ 启动错误: ' + String((e as ErrorEvent).message ?? e);
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// 瓦片缓存 Service Worker：看过的区域二次浏览零等待（只缓存地图瓦片/字体，不碰业务请求）
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* SW 不可用时静默降级 */
    });
  });
}
