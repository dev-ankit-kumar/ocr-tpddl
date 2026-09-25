// Lifecycle for the Tesseract.js engine. Tesseract.js runs recognition inside its
// own dedicated Web Worker, so the UI thread stays responsive during OCR.
import { createWorker, OEM, PSM, type LoggerMessage, type Worker } from 'tesseract.js'

type ProgressListener = (message: LoggerMessage) => void

let workerPromise: Promise<Worker> | null = null
let listener: ProgressListener | null = null

/** Absolute URL for a file in public/tesseract (the worker is spawned from a blob URL). */
function assetUrl(path: string): string {
  return new URL(`${import.meta.env.BASE_URL}tesseract/${path}`, window.location.href).href
}

async function spawn(): Promise<Worker> {
  const worker = await createWorker('eng', OEM.LSTM_ONLY, {
    workerPath: assetUrl('worker.min.js'),
    corePath: assetUrl('core'),
    langPath: assetUrl('lang'),
    gzip: true,
    // Load the worker from its real URL (not a blob: wrapper) so the service worker
    // can serve it and the WASM core offline.
    workerBlobURL: false,
    // Caches language data in IndexedDB so later visits skip the download.
    cacheMethod: 'write',
    logger: (message) => listener?.(message),
    errorHandler: (err) => console.error('Tesseract worker error:', err),
  })
  await worker.setParameters({
    tessedit_pageseg_mode: PRIMARY_PSM,
    // Keep runs of spaces in the text output; they often separate columns.
    preserve_interword_spaces: '1',
    user_defined_dpi: '300',
  })
  return worker
}

/**
 * "Single column of text of variable sizes" keeps table rows on one line across
 * columns (AUTO tends to split columns into separate blocks) and, unlike
 * SINGLE_BLOCK, still copes with ruled/bordered tables.
 */
export const PRIMARY_PSM = PSM.SINGLE_COLUMN
/**
 * Second pass: "sparse text" ignores layout and finds as many words as possible.
 * It recovers columns the primary pass occasionally drops on photos, but misses
 * isolated single characters, so the two passes are merged.
 */
export const SECONDARY_PSM = PSM.SPARSE_TEXT

/** Returns the shared engine, creating it on first use. */
export function getTesseractWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = spawn().catch((err) => {
      workerPromise = null
      throw err
    })
  }
  return workerPromise
}

/** Starts downloading/initialising the engine early so the first scan is faster. */
export function warmUpTesseract(): void {
  getTesseractWorker().catch(() => {
    // Errors are surfaced when the user actually runs OCR.
  })
}

/** Routes engine progress to `fn`; returns an unsubscribe that only clears its own listener. */
export function subscribeTesseractProgress(fn: ProgressListener): () => void {
  listener = fn
  return () => {
    if (listener === fn) listener = null
  }
}

/** Tesseract has no per-job cancel, so cancelling means terminating the worker. */
export async function terminateTesseract(): Promise<void> {
  const pending = workerPromise
  workerPromise = null
  if (!pending) return
  try {
    await (await pending).terminate()
  } catch {
    // Worker already gone.
  }
}
