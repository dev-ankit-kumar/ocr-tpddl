// PaddleOCR (PP-OCRv4 detection + recognition) running on ONNX Runtime Web inside a
// Web Worker, so the UI stays responsive. Used for nameplate photos, where it is far
// more accurate than Tesseract on stamped, faded or glary metal plates.
import * as ort from 'onnxruntime-web/wasm'
import type { BBox } from '../types'
import type { CropRect } from '../utils/imageFilters'
import {
  ctcDecode,
  detectionSize,
  findTextBoxes,
  keepLatin,
  normalizeLocalContrast,
  parseDictionary,
  REC_HEIGHT,
  toBgrTensor,
  type Raster,
} from '../services/paddle/paddleCore'

export interface PaddleLine {
  text: string
  /** 0–100, comparable with Tesseract confidences. */
  confidence: number
  bbox: BBox
}

export interface ReadOptions {
  /** Local contrast normalisation (helps faded plates). */
  normalize: boolean
  /** Text probability threshold for detection (lower finds fainter text). */
  detThreshold?: number
  /** Minimum mean probability for a detected region to be read. */
  boxMinScore?: number
}

export type PaddleRequest =
  | { id: number; op: 'init'; baseUrl: string }
  | { id: number; op: 'read'; image: Blob; options: ReadOptions }
  | { id: number; op: 'readRegions'; image: Blob; regions: CropRect[]; options: ReadOptions }

export type PaddleResponse =
  | { id: number; ok: true; lines?: PaddleLine[]; regions?: PaddleLine[][] }
  | { id: number; ok: false; error: string }
  | { id: number; progress: { stage: 'loading' | 'detecting' | 'reading'; value: number } }

/** Longest side fed to the detector: plenty for text lines, keeps it fast on 12 MP photos. */
const DET_MAX_SIDE = 1600
/** Longest side kept for recognition crops (memory bound on phones). */
const WORK_MAX_SIDE = 3200
const MIN_LINE_CONFIDENCE = 0.5

let models: Promise<{ det: ort.InferenceSession; rec: ort.InferenceSession; dictionary: string[] }> | null = null

function post(message: PaddleResponse) {
  self.postMessage(message)
}

function load(baseUrl: string, id: number) {
  if (models) return models
  ort.env.wasm.wasmPaths = `${baseUrl}paddle/ort/`
  // Multi-threading needs cross-origin isolation (COOP/COEP headers); otherwise use one thread.
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1
  const options: ort.InferenceSession.SessionOptions = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }
  let loaded = 0
  const tick = <T>(p: Promise<T>) =>
    p.then((v) => {
      post({ id, progress: { stage: 'loading', value: ++loaded / 3 } })
      return v
    })
  models = Promise.all([
    tick(ort.InferenceSession.create(`${baseUrl}paddle/models/det.onnx`, options)),
    tick(ort.InferenceSession.create(`${baseUrl}paddle/models/rec.onnx`, options)),
    tick(fetch(`${baseUrl}paddle/models/keys.txt`).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`keys.txt ${r.status}`))))),
  ]).then(([det, rec, keys]) => ({ det, rec, dictionary: parseDictionary(keys) }))
  models.catch(() => {
    models = null
  })
  return models
}

function canvasFrom(source: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, dw: number, dh: number) {
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(dw)), Math.max(1, Math.round(dh)))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D canvas is not available in this worker')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  return { canvas, ctx }
}

function rasterOf(ctx: OffscreenCanvasRenderingContext2D, width: number, height: number): Raster {
  return { data: ctx.getImageData(0, 0, width, height).data, width, height }
}

/** Detects and reads every text line in a canvas. Boxes are in that canvas's pixels. */
async function readCanvas(source: OffscreenCanvas, id: number, options: ReadOptions): Promise<PaddleLine[]> {
  const { det } = await models!
  const size = detectionSize(source.width, source.height, DET_MAX_SIDE)
  const detInput = canvasFrom(source, 0, 0, source.width, source.height, size.width, size.height)
  const detTensor = new ort.Tensor('float32', toBgrTensor(rasterOf(detInput.ctx, size.width, size.height)), [1, 3, size.height, size.width])
  post({ id, progress: { stage: 'detecting', value: 0 } })
  const detOut = (await det.run({ [det.inputNames[0]]: detTensor }))[det.outputNames[0]]
  const [, , mh, mw] = detOut.dims
  const sx = source.width / mw
  const sy = source.height / mh
  const boxes = findTextBoxes(detOut.data as Float32Array, mw, mh, options.detThreshold, options.boxMinScore).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)

  const lines: PaddleLine[] = []
  for (const [i, box] of boxes.entries()) {
    post({ id, progress: { stage: 'reading', value: i / boxes.length } })
    const line = await recognizeLine(source, box.x0 * sx, box.y0 * sy, (box.x1 - box.x0) * sx, (box.y1 - box.y0) * sy)
    if (line) lines.push(line)
  }
  return lines
}

/** Reads one line of text from a region of the canvas (no detection). */
async function recognizeLine(source: OffscreenCanvas, x: number, y: number, w: number, h: number): Promise<PaddleLine | null> {
  const { rec, dictionary } = await models!
  const recWidth = Math.min(2400, Math.max(REC_HEIGHT / 2, Math.round((w * REC_HEIGHT) / h)))
  const crop = canvasFrom(source, x, y, w, h, recWidth, REC_HEIGHT)
  const tensor = new ort.Tensor('float32', toBgrTensor(rasterOf(crop.ctx, recWidth, REC_HEIGHT)), [1, 3, REC_HEIGHT, recWidth])
  const out = (await rec.run({ [rec.inputNames[0]]: tensor }))[rec.outputNames[0]]
  const { text, confidence } = ctcDecode(out.data as Float32Array, out.dims[1], out.dims[2], dictionary)
  const clean = keepLatin(text)
  if (!clean || confidence < MIN_LINE_CONFIDENCE) return null
  return { text: clean, confidence: Math.round(confidence * 100), bbox: { x0: x, y0: y, x1: x + w, y1: y + h } }
}

/** Decodes the photo once into a working canvas (optionally contrast-normalised). */
async function prepare(image: Blob, { normalize }: ReadOptions) {
  const bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' })
  try {
    const scale = Math.min(1, WORK_MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const work = canvasFrom(bitmap, 0, 0, bitmap.width, bitmap.height, bitmap.width * scale, bitmap.height * scale)
    if (normalize) {
      const raster = rasterOf(work.ctx, work.canvas.width, work.canvas.height)
      work.ctx.putImageData(new ImageData(normalizeLocalContrast(raster), raster.width, raster.height), 0, 0)
    }
    return { canvas: work.canvas, scale }
  } finally {
    bitmap.close()
  }
}

const toImageCoords = (line: PaddleLine, scale: number, dx = 0, dy = 0, zoom = 1): PaddleLine => ({
  ...line,
  bbox: {
    x0: (line.bbox.x0 / zoom + dx) / scale,
    y0: (line.bbox.y0 / zoom + dy) / scale,
    x1: (line.bbox.x1 / zoom + dx) / scale,
    y1: (line.bbox.y1 / zoom + dy) / scale,
  },
})

async function handle(request: PaddleRequest): Promise<PaddleResponse> {
  const { id } = request
  if (request.op === 'init') {
    await load(request.baseUrl, id)
    return { id, ok: true }
  }
  if (!models) throw new Error('OCR engine not initialised')
  const { canvas, scale } = await prepare(request.image, request.options)
  if (request.op === 'read') {
    const lines = await readCanvas(canvas, id, request.options)
    return { id, ok: true, lines: lines.map((l) => toImageCoords(l, scale)) }
  }
  // Re-read small regions (e.g. the value box beside a label) zoomed in, which
  // recovers faint text the full-page pass missed.
  const regions: PaddleLine[][] = []
  for (const r of request.regions) {
    const x = Math.max(0, r.x * scale)
    const y = Math.max(0, r.y * scale)
    const w = Math.min(canvas.width - x, r.width * scale)
    const h = Math.min(canvas.height - y, r.height * scale)
    if (w < 4 || h < 4) {
      regions.push([])
      continue
    }
    // The region is one line (a value box): read it whole first, then look for
    // separate pieces with the detector on a zoomed copy.
    const whole = await recognizeLine(canvas, x, y, w, h)
    const zoom = Math.min(4, Math.max(1, 96 / h))
    const crop = canvasFrom(canvas, x, y, w, h, w * zoom, h * zoom)
    const pieces = (await readCanvas(crop.canvas, id, request.options)).map((l) => toImageCoords(l, scale, x, y, zoom))
    regions.push([...(whole ? [toImageCoords(whole, scale)] : []), ...pieces])
  }
  return { id, ok: true, regions }
}

self.onmessage = async (event: MessageEvent<PaddleRequest>) => {
  try {
    post(await handle(event.data))
  } catch (err) {
    post({ id: event.data.id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
