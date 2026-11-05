/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // A new version waits until every PlanOnMe tab is closed, so it never reloads the page in
      // the middle of a live session.
      registerType: 'prompt',
      injectRegister: 'script',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'PlanOnMe',
        short_name: 'PlanOnMe',
        description:
          'Plan a workshop, run your script, play sounds and show slides in a window you can share in Zoom.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f7f7fb',
        theme_color: '#4f46e5',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        // The app shell, the audience window and the PDF reader all work offline.
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,wasm,webmanifest}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/audience\.html/],
        cleanupOutdatedCaches: true,
        // Fonts and character maps that pdf.js loads only for some PDFs are kept once used.
        runtimeCaching: [
          {
            urlPattern: /\/assets\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'planonme-assets',
              expiration: { maxEntries: 100 },
            },
          },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        audience: 'audience.html',
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
