import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages では /リポジトリ名/ がベースになる
// 環境変数 VITE_BASE_URL で上書き可能（Netlify等では '/'）
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'AI Markdown Chat Note',
        short_name: 'AI Note',
        description: 'AI搭載のMarkdownノートアプリ',
        theme_color: '#070a13',
        background_color: '#070a13',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // アプリシェル（HTML/CSS/JS）をキャッシュ
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // GitHub API 等のネットワークリクエストはキャッシュしない
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.github\.com\//,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  base: process.env.VITE_BASE_URL ?? '/AiChatProjedct/',
  build: { outDir: 'dist' },
  server: { host: true },
});
