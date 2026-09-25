// Copies the Tesseract.js worker, WASM core and English language data from
// node_modules into public/tesseract so OCR runs without any CDN requests.
// Runs automatically before `npm run dev` and `npm run build`.
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const modules = join(root, 'node_modules')
const outDir = join(root, 'public', 'tesseract')

const assets = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  // The browser picks one of these at runtime based on SIMD support.
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'core/tesseract-core-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'core/tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'core/tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'lang/eng.traineddata.gz'],
]

let copied = 0
for (const [from, to] of assets) {
  const src = join(modules, from)
  const dest = join(outDir, to)
  if (!existsSync(src)) {
    console.error(`[tesseract-assets] Missing ${from}. Did you run "npm install"?`)
    process.exit(1)
  }
  if (existsSync(dest) && statSync(dest).size === statSync(src).size) continue
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(src, dest)
  copied++
}

console.log(`[tesseract-assets] ${copied ? `Copied ${copied} file(s)` : 'Up to date'} -> public/tesseract`)
