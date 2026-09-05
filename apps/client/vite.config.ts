import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { COLORS, GAME_DESCRIPTION, GAME_NAME } from './src/config.ts';

/**
 * `resolve.conditions` follows `docs/ARCHITECTURE.md` §4.3: while serving (and
 * under Vitest, which also runs in `serve` mode) the `development` export
 * condition makes `@xianxia/shared` resolve to its TypeScript source, so a
 * contract change is visible with no intermediate build. `vite build` drops the
 * override and consumes `packages/shared/dist`, which pnpm's topological run
 * order guarantees is fresh.
 */
export default defineConfig(({ command }) => ({
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
  resolve: {
    conditions: command === 'serve' ? ['development', 'browser', 'module', 'import'] : undefined,
  },
  build: {
    target: 'es2022',
    // React, the router and the socket client change far less often than game
    // code, so they get their own long-lived chunk.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          return /node_modules[/\\](react|react-dom|react-router|scheduler|zustand|socket\.io-client|engine\.io-client|socket\.io-parser)[/\\]/.test(
            id,
          )
            ? 'vendor'
            : undefined;
        },
      },
    },
    // Bitmap art is fetched at runtime through the manifest, so nothing here
    // should be inlined as a data URI.
    assetsInlineLimit: 0,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'fonts/*.woff2'],
      manifest: {
        name: GAME_NAME,
        short_name: GAME_NAME,
        description: GAME_DESCRIPTION,
        lang: 'zh-CN',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: COLORS.paper,
        background_color: COLORS.paper,
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // The API and the socket endpoint must never be answered by the shell.
        navigateFallbackDenylist: [/^\/api/, /^\/socket\.io/],
        runtimeCaching: [
          {
            // Bitmap art is content-addressed by the pipeline and safe to pin.
            urlPattern: /\/art\/.*\.(?:webp|png|jpg|json)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'xianxia-art',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          { urlPattern: /\/api\//, handler: 'NetworkOnly' },
        ],
      },
    }),
  ],
}));
