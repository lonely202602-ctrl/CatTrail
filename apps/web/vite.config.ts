import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// data/ 目录同时是静态演示模式的数据源（构建时原样拷贝进 dist）
export default defineConfig({
  plugins: [react()],
  publicDir: '../../data',
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
});
