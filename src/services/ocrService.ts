import type { Block, Page, PSM, Worker } from 'tesseract.js'
import type { BBox, OcrLine, OcrResult } from '../types'
import { layoutText } from './parser/layoutParser'
import { getTesseractWorker, PRIMARY_PSM, SECONDARY_PSM, subscribeTesseractProgress, type EngineKind } from '../workers/tesseractWorker'
import { agreement, combineEngines, iou, reconcileNumbers } from './ocrEnsemble'

export interface OcrProgressEvent {
  phase: 'load-engine' | 'recognize'
  /** Progress within the phase, 0–1. */
  progress: number
  status: string
}

function flattenLines(blocks: Block[] | null): OcrLine[] {
  if (!blocks) return []
  return blocks.flatMap((block) =>
    block.paragraphs.flatMap((paragraph) =>
      paragraph.lines.map((line) => ({
        bbox: line.bbox,
        words: line.words
          .filter((w) => w.text.trim().length > 0)
          .map((w) => ({ text: w.text.trim(), confidence: w.confidence, bbox: w.bbox })),
      })),
    ),
  )
}

function toResult(page: Page): OcrResult {
  const lines = flattenLines(page.blocks).filter((l) => l.words.length > 0)
  return {
    // Rebuilt from word positions so rows stay intact on skewed photos; Tesseract's own text as fallback.
    text: lines.length ? layoutText(lines) : page.text.replace(/\n{3,}/g, '\n\n').trim(),
    confidence: page.confidence,
    lines,
  }
}

// Tesseract reports 0–1 per loading status; map them onto one increasing scale.
const LOAD_STATUSES = ['loading tesseract core', 'initializing tesseract', 'loading language traineddata', 'initializing api']

function loadProgress(status: string, progress: number): number {
  const index = Math.max(0, LOAD_STATUSES.indexOf(status))
  return (index + progress) / LOAD_STATUSES.length
}

/** Extra words from the second pass must be at least this confident (filters border noise). */
const MERGE_MIN_CONFIDENCE = 50

function overlaps(a: BBox, b: BBox): boolean {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
  if (w <= 0 || h <= 0) return false
  const smaller = Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0))
  return (w * h) / Math.max(1, smaller) > 0.3
}

/** Adds confident words found only by the secondary pass to the primary result. */
function mergeResults(primary: OcrResult, secondary: OcrResult): OcrResult {
  const known = primary.lines.flatMap((l) => l.words.map((w) => w.bbox))
  const extra = secondary.lines
    .map((line) => ({
      ...line,
      words: line.words.filter((w) => w.confidence >= MERGE_MIN_CONFIDENCE && !known.some((b) => overlaps(b, w.bbox))),
    }))
    .filter((l) => l.words.length > 0)
  if (extra.length === 0) return primary

  const lines = [...primary.lines, ...extra]
  const words = lines.flatMap((l) => l.words)
  return {
    lines,
    text: layoutText(lines),
    confidence: words.reduce((sum, w) => sum + w.confidence, 0) / words.length,
  }
}

async function recognizeWith(worker: Worker, image: Blob, psm: PSM): Promise<OcrResult> {
  await worker.setParameters({ tessedit_pageseg_mode: psm })
  const { data } = await worker.recognize(image, {}, { text: true, blocks: true })
  return toResult(data)
}

function withLines(lines: OcrLine[], confidence: number): OcrResult {
  return { lines, confidence, text: layoutText(lines) }
}

/** Raw output of the three recognition passes, before merging. */
export interface OcrPasses {
  block: OcrResult
  sparse: OcrResult
  /** Null when the legacy engine failed (e.g. out of memory on an old phone). */
  legacy: OcrResult | null
}

/**
 * Merges the passes: numbers rebuilt from both engines, cross-checked against the
 * sparse pass, then words only the sparse pass found are added.
 */
export function mergePasses({ block, sparse, legacy }: OcrPasses): OcrResult {
  const combined = legacy ? combineEngines(block.lines, legacy.lines) : block.lines
  const primary = withLines(reconcileNumbers(combined, sparse.lines), block.confidence)
  const merged = mergeResults(primary, sparse)
  return { ...merged, lines: corroborate(merged.lines, [block, sparse, legacy].filter((p) => p !== null)) }
}

/**
 * A value that two independent passes read the same way is trustworthy even if each
 * pass alone was unsure; it takes the highest confidence among the agreeing readings.
 * This keeps review highlights for values that really are in doubt.
 */
function corroborate(lines: OcrLine[], passes: OcrResult[]): OcrLine[] {
  const readings = passes.map((p) => p.lines.flatMap((l) => l.words))
  return lines.map((line) => ({
    ...line,
    words: line.words.map((word) => {
      const agreeing = readings
        .map((words) => words.find((w) => iou(w.bbox, word.bbox) >= 0.3 && agreement({ ...w, text: word.text }, w) === 'agree'))
        .filter((w) => w !== undefined)
      if (agreeing.length < 2) return word
      return { ...word, confidence: Math.max(word.confidence, ...agreeing.map((w) => w.confidence)) }
    }),
  }))
}

/**
 * Runs OCR entirely in the browser, with both engines working in parallel:
 * - LSTM engine: block layout, then sparse layout (recovers words the first misses)
 * - legacy engine: block layout on the full image. (Giving it only the text regions
 *   was faster but measurably less accurate, so it always sees the whole page.)
 */
export async function recognizePasses(image: Blob, onProgress: (e: OcrProgressEvent) => void): Promise<OcrPasses> {
  // Progress: loading = average of both engines; recognition = 3 passes in total.
  const load = { lstm: 0, legacy: 0 }
  const done = { lstm: 0, legacy: 0 }
  const current = { lstm: 0, legacy: 0 }
  const report = () => {
    const recognizing = (done.lstm + current.lstm + done.legacy + current.legacy) / 3
    if (recognizing > 0) onProgress({ phase: 'recognize', progress: recognizing, status: 'recognizing text' })
    else onProgress({ phase: 'load-engine', progress: (load.lstm + load.legacy) / 2, status: 'loading' })
  }
  const listen = (kind: EngineKind) =>
    subscribeTesseractProgress(kind, ({ status, progress }) => {
      if (status === 'recognizing text') current[kind] = progress
      else load[kind] = loadProgress(status, progress)
      report()
    })
  const unsubscribe = [listen('lstm'), listen('legacy')]

  const runLstm = async () => {
    const worker = await getTesseractWorker('lstm')
    const block = await recognizeWith(worker, image, PRIMARY_PSM)
    done.lstm = 1
    current.lstm = 0
    const sparse = await recognizeWith(worker, image, SECONDARY_PSM)
    return { block, sparse }
  }
  const runLegacy = async () => recognizeWith(await getTesseractWorker('legacy'), image, PRIMARY_PSM)

  try {
    const [lstm, legacy] = await Promise.all([
      runLstm(),
      runLegacy().catch((err) => {
        // The legacy engine is an accuracy booster; never fail a scan because of it.
        console.warn('Legacy OCR engine failed, continuing with LSTM only:', err)
        return null
      }),
    ])
    return { ...lstm, legacy }
  } finally {
    unsubscribe.forEach((u) => u())
  }
}

export async function recognizeImage(image: Blob, onProgress: (e: OcrProgressEvent) => void): Promise<OcrResult> {
  return mergePasses(await recognizePasses(image, onProgress))
}
