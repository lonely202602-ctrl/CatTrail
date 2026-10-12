import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// 瓦片缓存 Service Worker：只缓存同源 /tiles/*（后端直连代理的地图瓦片/字体），不碰业务请求
const SW_CODE = `const CACHE = 'cattrail-tiles-v2';
self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith('/tiles/')) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(e.request);
    if (hit) return hit;
    try {
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    } catch (err) {
      return new Response('', { status: 504 });
    }
  })());
});
`;

/** dev 下中间件伺服 /sw.js，build 时打进 dist */
function catTrailSw(): Plugin {
  return {
    name: 'cattrail-sw',
    configureServer(server) {
      server.middlewares.use('/sw.js', (_req, res) => {
        res.setHeader('Content-Type', 'application/javascript');
        res.end(SW_CODE);
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: SW_CODE });
    },
  };
}

// data/ 目录同时是静态演示模式的数据源（构建时原样拷贝进 dist）
export default defineConfig({
  plugins: [react(), catTrailSw()],
  publicDir: '../../data',
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/tiles': 'http://127.0.0.1:8787',
    },
  },
});
