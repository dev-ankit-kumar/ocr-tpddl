import type { Block, Page, PSM, Worker } from 'tesseract.js'
import type { BBox, OcrLine, OcrResult } from '../types'
import { layoutText } from './parser/layoutParser'
import { getTesseractWorker, PRIMARY_PSM, SECONDARY_PSM, subscribeTesseractProgress } from '../workers/tesseractWorker'

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

/** Runs OCR on an image entirely in the browser (two passes, merged). */
export async function recognizeImage(image: Blob, onProgress: (e: OcrProgressEvent) => void): Promise<OcrResult> {
  let pass = 0
  const unsubscribe = subscribeTesseractProgress(({ status, progress }) => {
    if (status === 'recognizing text') onProgress({ phase: 'recognize', progress: (pass + progress) / 2, status })
    else onProgress({ phase: 'load-engine', progress: loadProgress(status, progress), status })
  })
  try {
    const worker = await getTesseractWorker()
    onProgress({ phase: 'recognize', progress: 0, status: 'recognizing text' })
    const primary = await recognizeWith(worker, image, PRIMARY_PSM)
    pass = 1
    const secondary = await recognizeWith(worker, image, SECONDARY_PSM)
    return mergeResults(primary, secondary)
  } finally {
    unsubscribe()
  }
}
