import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages では /リポジトリ名/ がベースになる
// 環境変数 VITE_BASE_URL で上書き可能（Netlify等では '/'）
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_URL ?? '/AiChatProjedct/',
  build: { outDir: 'dist' },
  server: { host: true },
});
