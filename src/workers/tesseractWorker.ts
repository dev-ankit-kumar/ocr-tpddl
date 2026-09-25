// Lifecycle for the Tesseract.js engines. Each engine runs recognition inside its own
// dedicated Web Worker, so the UI thread stays responsive and both can run in parallel.
import { createWorker, OEM, PSM, type LoggerMessage, type Worker } from 'tesseract.js'

type ProgressListener = (message: LoggerMessage) => void

/**
 * - lstm: the neural engine; best at letters and words.
 * - legacy: the older character-based engine; keeps decimal points and other small
 *   punctuation that the LSTM engine drops on photos.
 */
export type EngineKind = 'lstm' | 'legacy'

const workers = new Map<EngineKind, Promise<Worker>>()
const listeners = new Map<EngineKind, ProgressListener>()

/** Absolute URL for a file in public/tesseract. */
function assetUrl(path: string): string {
  return new URL(`${import.meta.env.BASE_URL}tesseract/${path}`, window.location.href).href
}

async function spawn(kind: EngineKind): Promise<Worker> {
  const legacy = kind === 'legacy'
  const worker = await createWorker('eng', legacy ? OEM.TESSERACT_ONLY : OEM.LSTM_ONLY, {
    workerPath: assetUrl('worker.min.js'),
    corePath: assetUrl(legacy ? 'core-legacy' : 'core'),
    langPath: assetUrl(legacy ? 'lang-legacy' : 'lang'),
    legacyCore: legacy,
    legacyLang: legacy,
    gzip: true,
    // Load the worker from its real URL (not a blob: wrapper) so the service worker
    // can serve it and the WASM core offline.
    workerBlobURL: false,
    // Caches language data in IndexedDB; separate keys because the two models differ.
    cacheMethod: 'write',
    cachePath: legacy ? 'tesseract-legacy' : 'tesseract-lstm',
    logger: (message) => listeners.get(kind)?.(message),
    errorHandler: (err) => console.error(`Tesseract ${kind} worker error:`, err),
  })
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
    // Keep runs of spaces in the text output; they often separate columns.
    preserve_interword_spaces: '1',
    user_defined_dpi: '300',
  })
  return worker
}

/**
 * Page segmentation modes. "Single block" reads table rows straight across; "sparse
 * text" ignores layout and recovers words the first pass misses on ruled tables or
 * busy photos. Both were chosen by benchmarking against phone photos of tables.
 */
export const PRIMARY_PSM = PSM.SINGLE_BLOCK
export const SECONDARY_PSM = PSM.SPARSE_TEXT

/** Returns the shared engine of a kind, creating it on first use. */
export function getTesseractWorker(kind: EngineKind = 'lstm'): Promise<Worker> {
  let pending = workers.get(kind)
  if (!pending) {
    pending = spawn(kind).catch((err) => {
      workers.delete(kind)
      throw err
    })
    workers.set(kind, pending)
  }
  return pending
}

/** Starts downloading/initialising both engines early so the first scan is faster. */
export function warmUpTesseract(): void {
  for (const kind of ['lstm', 'legacy'] as const) {
    getTesseractWorker(kind).catch(() => {
      // Errors are surfaced when the user actually runs OCR.
    })
  }
}

/** Routes an engine's progress to `fn`; returns an unsubscribe that only clears its own listener. */
export function subscribeTesseractProgress(kind: EngineKind, fn: ProgressListener): () => void {
  listeners.set(kind, fn)
  return () => {
    if (listeners.get(kind) === fn) listeners.delete(kind)
  }
}

/** Tesseract has no per-job cancel, so cancelling means terminating the workers. */
export async function terminateTesseract(): Promise<void> {
  const pending = [...workers.values()]
  workers.clear()
  await Promise.all(
    pending.map(async (p) => {
      try {
        await (await p).terminate()
      } catch {
        // Worker already gone.
      }
    }),
  )
}
