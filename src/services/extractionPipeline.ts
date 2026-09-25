import type { ExtractionResult, ProcessingProgress } from '../types'
import { preprocessImage } from './imagePreprocessor'
import { recognizeImage } from './ocrService'
import { parseOcrResult } from './parser'

export interface ExtractOptions {
  autoCrop: boolean
  onProgress: (p: ProcessingProgress) => void
  signal?: AbortSignal
}

// Share of the overall progress bar given to each step.
const WEIGHTS = { preprocess: [0, 0.08], 'load-engine': [0.08, 0.25], recognize: [0.25, 0.95], parse: [0.95, 1] } as const

function overall(step: keyof typeof WEIGHTS, local: number): number {
  const [start, end] = WEIGHTS[step]
  return start + (end - start) * Math.min(1, Math.max(0, local))
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Extraction cancelled', 'AbortError')
}

/** Image → preprocessing → OCR → structured table. Everything runs locally. */
export async function extractDocument(image: Blob, { autoCrop, onProgress, signal }: ExtractOptions): Promise<ExtractionResult> {
  onProgress({ step: 'preprocess', progress: 0, label: 'Preparing image…' })
  const prepared = await preprocessImage(image, { autoCrop })
  throwIfAborted(signal)

  onProgress({ step: 'load-engine', progress: overall('load-engine', 0), label: 'Loading OCR engine…' })
  const ocr = await recognizeImage(prepared, ({ phase, progress }) => {
    if (signal?.aborted) return
    if (phase === 'load-engine') {
      onProgress({ step: 'load-engine', progress: overall('load-engine', progress), label: 'Loading OCR engine…' })
    } else {
      onProgress({ step: 'recognize', progress: overall('recognize', progress), label: 'Reading text…' })
    }
  })
  throwIfAborted(signal)

  onProgress({ step: 'parse', progress: overall('parse', 0), label: 'Structuring data…' })
  const parse = parseOcrResult(ocr)
  onProgress({ step: 'parse', progress: 1, label: 'Done' })
  return { ocr, parse }
}
