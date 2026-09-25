// Copies the PaddleOCR models and ONNX Runtime Web from node_modules into
// public/paddle so OCR runs on the device without any CDN requests.
// Runs automatically before `npm run dev` and `npm run build`.
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const modules = join(root, 'node_modules')
const publicDir = join(root, 'public')

const assets = [
  // PaddleOCR PP-OCRv4 models: detection, recognition and its character dictionary.
  ['@gutenye/ocr-models/assets/ch_PP-OCRv4_det_infer.onnx', 'paddle/models/det.onnx'],
  ['@gutenye/ocr-models/assets/ch_PP-OCRv4_rec_infer.onnx', 'paddle/models/rec.onnx'],
  ['@gutenye/ocr-models/assets/ppocr_keys_v1.txt', 'paddle/models/keys.txt'],
  // ONNX Runtime Web (multi-threaded SIMD WebAssembly build).
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

console.log(`[ocr-assets] ${copied ? `Copied ${copied} file(s)` : 'Up to date'} -> public/paddle`)
