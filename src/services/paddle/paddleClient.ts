// Main-thread client for the PaddleOCR worker.
import type { CropRect } from '../../utils/imageFilters'
import type { PaddleLine, PaddleRequest, PaddleResponse, ReadOptions } from '../../workers/paddle.worker'

export type { PaddleLine } from '../../workers/paddle.worker'

export type PaddleProgress = { stage: 'loading' | 'detecting' | 'reading'; value: number }

type Pending = {
  resolve: (r: Extract<PaddleResponse, { ok: true }>) => void
  reject: (e: Error) => void
  onProgress?: (p: PaddleProgress) => void
}

let worker: Worker | null = null
let ready: Promise<void> | null = null
let nextId = 1
const pending = new Map<number, Pending>()

type RequestBody = PaddleRequest extends infer R ? (R extends PaddleRequest ? Omit<R, 'id'> : never) : never

function send(body: RequestBody, onProgress?: (p: PaddleProgress) => void) {
  return new Promise<Extract<PaddleResponse, { ok: true }>>((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject, onProgress })
    getWorker().postMessage({ ...body, id } as PaddleRequest)
  })
}

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('../../workers/paddle.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<PaddleResponse>) => {
    const msg = event.data
    const job = pending.get(msg.id)
    if (!job) return
    if ('progress' in msg) return job.onProgress?.(msg.progress)
    pending.delete(msg.id)
    if (msg.ok) job.resolve(msg)
    else job.reject(new Error(msg.error))
  }
  worker.onerror = (e) => {
    const error = new Error(e.message || 'The OCR engine crashed')
    for (const job of pending.values()) job.reject(error)
    pending.clear()
    terminatePaddle()
  }
  return worker
}

/** Loads the models (once). Safe to call early to warm up. */
export function initPaddle(onProgress?: (p: PaddleProgress) => void): Promise<void> {
  if (!ready) {
    const baseUrl = new URL(import.meta.env.BASE_URL, window.location.href).href
    ready = send({ op: 'init', baseUrl }, onProgress).then(() => undefined)
    ready.catch(() => {
      ready = null
    })
  }
  return ready
}

export async function readImage(image: Blob, options: ReadOptions, onProgress?: (p: PaddleProgress) => void): Promise<PaddleLine[]> {
  await initPaddle(onProgress)
  return (await send({ op: 'read', image, options }, onProgress)).lines ?? []
}

/** Re-reads regions of the image (image pixel coordinates) at higher zoom. */
export async function readRegions(image: Blob, regions: CropRect[], options: ReadOptions): Promise<PaddleLine[][]> {
  if (regions.length === 0) return []
  await initPaddle()
  return (await send({ op: 'readRegions', image, regions, options })).regions ?? []
}

/** Stops any running recognition (used for Cancel). */
export function terminatePaddle(): void {
  worker?.terminate()
  worker = null
  ready = null
  for (const job of pending.values()) job.reject(new Error('Cancelled'))
  pending.clear()
}
