// Copies the OCR engines' runtime files and models from node_modules into public/
// so OCR runs without any CDN requests:
//   public/tesseract  Tesseract.js (table mode)
//   public/paddle     PaddleOCR models + ONNX Runtime Web (nameplate mode)
// Runs automatically before `npm run dev` and `npm run build`.
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const modules = join(root, 'node_modules')
const publicDir = join(root, 'public')

const assets = [
  ['tesseract.js/dist/worker.min.js', 'tesseract/worker.min.js'],
  // The browser picks one of these at runtime based on SIMD support.
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract/core/tesseract-core-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract/core/tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract/core/tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'tesseract/lang/eng.traineddata.gz'],
  // Legacy (character-based) engine, run alongside LSTM: it keeps decimal points the LSTM drops.
  ['tesseract.js-core/tesseract-core.wasm.js', 'tesseract/core-legacy/tesseract-core.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd.wasm.js', 'tesseract/core-legacy/tesseract-core-simd.wasm.js'],
  ['tesseract.js-core/tesseract-core-relaxedsimd.wasm.js', 'tesseract/core-legacy/tesseract-core-relaxedsimd.wasm.js'],
  ['@tesseract.js-data/eng/4.0.0/eng.traineddata.gz', 'tesseract/lang-legacy/eng.traineddata.gz'],
  // PaddleOCR (PP-OCRv4) for nameplate photos: much better than Tesseract on stamped/metal text.
  ['@gutenye/ocr-models/assets/ch_PP-OCRv4_det_infer.onnx', 'paddle/models/det.onnx'],
  ['@gutenye/ocr-models/assets/ch_PP-OCRv4_rec_infer.onnx', 'paddle/models/rec.onnx'],
  ['@gutenye/ocr-models/assets/ppocr_keys_v1.txt', 'paddle/models/keys.txt'],
  ['onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', 'paddle/ort/ort-wasm-simd-threaded.wasm'],
  ['onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', 'paddle/ort/ort-wasm-simd-threaded.mjs'],
]

let copied = 0
for (const [from, to] of assets) {
  const src = join(modules, from)
  const dest = join(publicDir, to)
  if (!existsSync(src)) {
    console.error(`[ocr-assets] Missing ${from}. Did you run "npm install"?`)
    process.exit(1)
  }
  if (existsSync(dest) && statSync(dest).size === statSync(src).size) continue
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(src, dest)
  copied++
}

console.log(`[ocr-assets] ${copied ? `Copied ${copied} file(s)` : 'Up to date'} -> public/tesseract, public/paddle`)
