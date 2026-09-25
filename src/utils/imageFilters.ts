// Pure pixel operations shared by the preprocessing worker and its main-thread fallback.

/** Longest edge after resizing. Big enough for small print, small enough to stay fast. */
export const MAX_EDGE = 2400
/**
 * Small images are upscaled (at most 2×) towards this size. Going higher was
 * measured to hurt accuracy on phone photos, so keep it modest.
 */
export const MIN_EDGE = 1200

export function targetSize(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height)
  let scale = 1
  if (longest > MAX_EDGE) scale = MAX_EDGE / longest
  else if (longest < MIN_EDGE) scale = Math.min(2, MIN_EDGE / longest)
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

/** Long edge of the downscaled copy used for content detection. */
export const DETECT_EDGE = 800

/** Mean of the (2r+1)² window around every pixel, via an integral image (O(n) for any r). */
function boxMean(gray: Uint8ClampedArray, width: number, height: number, r: number): Float32Array {
  const stride = width + 1
  const integral = new Float64Array(stride * (height + 1))
  for (let y = 0; y < height; y++) {
    let rowSum = 0
    for (let x = 0; x < width; x++) {
      rowSum += gray[y * width + x]
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + rowSum
    }
  }
  const out = new Float32Array(gray.length)
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(height, y + r + 1)
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(width, x + r + 1)
      const sum = integral[y1 * stride + x1] - integral[y0 * stride + x1] - integral[y1 * stride + x0] + integral[y0 * stride + x0]
      out[y * width + x] = sum / ((x1 - x0) * (y1 - y0))
    }
  }
  return out
}

/** Value at fraction `p` of a histogram-counted axis (robust min/max). */
function percentileIndex(counts: Uint32Array, total: number, p: number): number {
  const target = total * p
  let acc = 0
  for (let i = 0; i < counts.length; i++) {
    acc += counts[i]
    if (acc > target) return i
  }
  return counts.length - 1
}

/**
 * Finds the area of a photo that contains text, in the coordinates of the (small)
 * input. Text strokes are pixels clearly darker than their neighbourhood, which
 * smooth backgrounds (tables, walls, lighting gradients) never are. Returns null
 * when the content already fills the frame or too little text is found, so nothing
 * is cropped on a guess. Background clutter confuses Tesseract's layout analysis
 * (whole columns can go missing), so trimming it matters a lot.
 */
export function findContentBounds(rgba: Uint8ClampedArray, width: number, height: number): CropRect | null {
  const gray = toGray(rgba)
  const r = Math.max(4, Math.round(Math.max(width, height) / 100))
  const mean = boxMean(gray, width, height, r)
  const colCounts = new Uint32Array(width)
  const rowCounts = new Uint32Array(height)
  let dark = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (gray[i] < mean[i] - 20) {
        colCounts[x]++
        rowCounts[y]++
        dark++
      }
    }
  }
  if (dark < width * height * 0.002) return null

  // Trim 0.5% of stray dark pixels on each side, then pad generously.
  const left = percentileIndex(colCounts, dark, 0.005)
  const right = percentileIndex(colCounts, dark, 0.995)
  const top = percentileIndex(rowCounts, dark, 0.005)
  const bottom = percentileIndex(rowCounts, dark, 0.995)
  const padX = Math.round((right - left) * 0.06 + width * 0.01)
  const padY = Math.round((bottom - top) * 0.06 + height * 0.01)
  const x = Math.max(0, left - padX)
  const y = Math.max(0, top - padY)
  const crop = { x, y, width: Math.min(width, right + 1 + padX) - x, height: Math.min(height, bottom + 1 + padY) - y }

  return crop.width * crop.height > width * height * 0.8 ? null : crop
}

function toGray(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(rgba.length / 4)
  for (let i = 0, j = 0; j < gray.length; i += 4, j++) {
    gray[j] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]
  }
  return gray
}
