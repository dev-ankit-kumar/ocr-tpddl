// Crop → resize → enhance, written against the subset of the canvas API shared by
// OffscreenCanvas (worker) and HTMLCanvasElement (main-thread fallback).
import { DETECT_EDGE, enhanceForOcr, findContentBounds, targetSize, type CropRect } from './imageFilters'

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
export type CanvasFactory<C> = (width: number, height: number) => { canvas: C; ctx: Ctx2D }

export interface RenderOptions {
  /** Grayscale, contrast and sharpening. */
  enhance: boolean
  /** Crop to the detected sheet of paper. */
  autoCrop: boolean
}

function detectCrop<C>(source: CanvasImageSource, width: number, height: number, create: CanvasFactory<C>): CropRect | null {
  const scale = Math.min(1, DETECT_EDGE / Math.max(width, height))
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  const { ctx } = create(w, h)
  ctx.drawImage(source, 0, 0, w, h)
  const bounds = findContentBounds(ctx.getImageData(0, 0, w, h).data, w, h)
  if (!bounds) return null
  return {
    x: Math.round(bounds.x / scale),
    y: Math.round(bounds.y / scale),
    width: Math.round(bounds.width / scale),
    height: Math.round(bounds.height / scale),
  }
}

export function renderForOcr<C>(source: CanvasImageSource, width: number, height: number, options: RenderOptions, create: CanvasFactory<C>): C {
  const crop = (options.autoCrop && detectCrop(source, width, height, create)) || { x: 0, y: 0, width, height }
  const size = targetSize(crop.width, crop.height)
  const { canvas, ctx } = create(size.width, size.height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, size.width, size.height)
  if (options.enhance) {
    const imageData = ctx.getImageData(0, 0, size.width, size.height)
    enhanceForOcr(imageData.data, size.width, size.height)
    ctx.putImageData(imageData, 0, 0)
  }
  return canvas
}
