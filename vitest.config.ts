import { defineConfig } from 'vitest/config'

// Unit tests only need TypeScript + JSON. Keeping them off the app's Vite config
// (PWA, Tailwind, React plugins) and its cache folder avoids interference with a
// running dev server or build.
export default defineConfig({
  cacheDir: 'node_modules/.vitest',
  test: {
    include: ['src/**/*.test.ts'],
  },
})
