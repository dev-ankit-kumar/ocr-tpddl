// Crops and resizes an image off the main thread using OffscreenCanvas.
import { renderForOcr, type CanvasFactory, type RenderOptions } from '../utils/renderForOcr'

export type PreprocessRequest = { id: number; image: Blob } & RenderOptions

export type PreprocessResponse = { id: number; blob: Blob } | { id: number; error: string }

const createCanvas: CanvasFactory<OffscreenCanvas> = (width, height) => {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D canvas is not available in this worker')
  return { canvas, ctx }
}

async function process(request: PreprocessRequest): Promise<Blob> {
  const bitmap = await createImageBitmap(request.image, { imageOrientation: 'from-image' })
  try {
    const canvas = renderForOcr(bitmap, bitmap.width, bitmap.height, request, createCanvas)
    return await canvas.convertToBlob({ type: 'image/png' })
  } finally {
    bitmap.close()
  }
}

self.onmessage = async (event: MessageEvent<PreprocessRequest>) => {
  const { id } = event.data
  let response: PreprocessResponse
  try {
    response = { id, blob: await process(event.data) }
  } catch (err) {
    response = { id, error: err instanceof Error ? err.message : String(err) }
  }
  self.postMessage(response)
}
