import { renderForOcr, type CanvasFactory, type RenderOptions } from '../utils/renderForOcr'
import type { PreprocessRequest, PreprocessResponse } from '../workers/preprocess.worker'

let worker: Worker | null = null
let workerBroken = false
let nextId = 1
const pending = new Map<number, { resolve: (b: Blob) => void; reject: (e: Error) => void }>()

function supportsWorkerPath(): boolean {
  return !workerBroken && typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined'
}

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('../workers/preprocess.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<PreprocessResponse>) => {
    const job = pending.get(event.data.id)
    if (!job) return
    pending.delete(event.data.id)
    if ('blob' in event.data) job.resolve(event.data.blob)
    else job.reject(new Error(event.data.error))
  }
  worker.onerror = () => {
    // Worker failed to load (e.g. very old browser); reject jobs so callers fall back.
    workerBroken = true
    worker?.terminate()
    worker = null
    for (const job of pending.values()) job.reject(new Error('Preprocessing worker crashed'))
    pending.clear()
  }
  return worker
}

function runInWorker(image: Blob, options: RenderOptions): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    const request: PreprocessRequest = { id, image, ...options }
    getWorker().postMessage(request)
  })
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('This image could not be read. Try a JPG or PNG file.'))
    }
    img.src = url
  })
}

const createCanvas: CanvasFactory<HTMLCanvasElement> = (width, height) => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Your browser does not support canvas image processing.')
  return { canvas, ctx }
}

async function runOnMainThread(image: Blob, options: RenderOptions): Promise<Blob> {
  const img = await loadImage(image)
  const canvas = renderForOcr(img, img.naturalWidth, img.naturalHeight, options, createCanvas)
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image.'))), 'image/png'),
  )
}

/** Crops (optionally) and resizes an image for OCR. Never leaves the device. */
export async function preprocessImage(image: Blob, options: RenderOptions): Promise<Blob> {
  if (supportsWorkerPath()) {
    try {
      return await runInWorker(image, options)
    } catch (err) {
      console.warn('Worker preprocessing failed, falling back to main thread:', err)
    }
  }
  return runOnMainThread(image, options)
}
