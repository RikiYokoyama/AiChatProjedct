import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // 相対パスでアセットを読み込むようにする (Electron用)
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
  server: {
    port: 5173
  }
})
