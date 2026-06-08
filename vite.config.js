import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './', // 相対パスでのビルドアセット読み込みを強制
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
  server: {
    port: 5173
  }
});
