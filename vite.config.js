import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Served from https://<user>.github.io/shopping-list/, so every asset URL
// needs that prefix. Locally `vite dev` serves from the root instead.
const base = process.env.GITHUB_ACTIONS ? '/shopping-list/' : '/';

export default defineConfig({
  base,
  // A different port from the cookbook's 5175, so both can run at once —
  // which is exactly what you want while building the door between them.
  server: { port: 5176 },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'Shopping List',
        short_name: 'Shopping',
        description: 'Shared shopping lists on a table.',
        theme_color: '#46607A',
        background_color: '#FAF8F3',
        display: 'standalone',
        // Unlike the cookbook this is a phone-first app: it is used one-handed,
        // upright, in a shop.
        orientation: 'any',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // The Firebase SDK is fetched only when you sign in; precaching it
        // would download megabytes for someone who never shares a list.
        globIgnores: ['**/index.esm-*.js'],
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /\/assets\/index\.esm-.*\.js$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'firebase-sdk',
              expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
    /* No Firebase config, always.

       Vite hands .env.local to the tests, so whether sync looked configured
       depended on whether the developer happened to have one — the app then
       waits for an account that never arrives, and a list it cannot find
       reads as "opening…" rather than "not here any more". It passed in CI,
       where there is no such file, and failed here. Tests that behave
       differently on two machines are worse than no tests. The ones that
       need a database inject their own (see src/lib/sync.js __useTestSdk). */
    env: { VITE_FIREBASE_CONFIG: '' },
  },
});
