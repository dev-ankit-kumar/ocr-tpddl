import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defaultClientConditions, defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Cross-origin isolation enables multi-threaded WebAssembly for the OCR engines
// (several times faster). Everything the app loads is same-origin, so it's safe.
// The same headers are set for production in vercel.json / public/_headers.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

// https://vite.dev/config/
export default defineConfig({
  // ONNX Runtime's WebAssembly is served from public/paddle (see scripts/copy-ocr-assets.mjs);
  // this condition stops Vite from bundling a second 14 MB copy of it.
  resolve: { conditions: ['onnxruntime-web-use-extern-wasm', ...defaultClientConditions] },
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
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
        name: 'SnapSheet – Transformer Nameplate to Excel',
        short_name: 'SnapSheet',
        description: 'Reads KVA, Year of MFG, Manufacturer and Sr. No. from transformer nameplate photos into Excel. OCR runs on your device.',
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
        // App shell (HTML, JS incl. the lazy xlsx chunk and the worker, CSS, icons) is precached.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // The OCR engine (~30 MB) is cached on first use instead of precached.
        globIgnores: ['paddle/**'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/paddle/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'ocr-engine',
              expiration: { maxEntries: 20 },
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
