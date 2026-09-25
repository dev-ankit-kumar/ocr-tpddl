import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // A new version waits until the app is next opened instead of reloading
      // mid-session, so an unsaved table is never lost to an update.
      registerType: 'prompt',
      injectRegister: 'script-defer',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'SnapSheet – Documents to Excel',
        short_name: 'SnapSheet',
        description: 'Turn photographed documents, receipts and tables into Excel files. OCR runs entirely on your device.',
        theme_color: '#0f766e',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        categories: ['productivity', 'utilities'],
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell (HTML, JS incl. the lazy xlsx chunk and workers, CSS, icons) is precached.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // The OCR engine is large and only one core variant is used per device,
        // so it's cached on first use instead of precached.
        globIgnores: ['tesseract/**'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/tesseract/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'ocr-engine',
              expiration: { maxEntries: 10 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  worker: {
    format: 'es',
  },
  build: {
    // xlsx is lazy-loaded on download; keep the warning meaningful for the main chunk.
    chunkSizeWarningLimit: 700,
  },
})
