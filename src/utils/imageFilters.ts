// Pure pixel operations shared by the preprocessing worker and its main-thread fallback.

/** Longest edge after resizing. Big enough for small print, small enough to stay fast. */
export const MAX_EDGE = 2400
/** Small images are upscaled so glyphs reach a size Tesseract handles well. */
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

/**
 * Divides out uneven lighting (shadows, gradients, vignetting) by comparing each
 * pixel with its local background brightness. Tesseract binarizes with one global
 * threshold, so without this, dimmer parts of a photo can vanish entirely.
 */
function normalizeIllumination(gray: Uint8ClampedArray, width: number, height: number): void {
  const background = estimateBackground(gray, width, height)
  for (let i = 0; i < gray.length; i++) {
    gray[i] = (gray[i] / Math.max(1, background[i])) * 245
  }
}

/**
 * Paper brightness per pixel. Taking the maximum per block ignores dark text (a
 * plain local mean would be dragged down by it and leave grey halos that Tesseract
 * mistakes for picture regions); the block grid is then smoothed and upsampled.
 */
function estimateBackground(gray: Uint8ClampedArray, width: number, height: number): Float32Array {
  const block = Math.max(16, Math.round(Math.max(width, height) / 80))
  const bw = Math.ceil(width / block)
  const bh = Math.ceil(height / block)
  let grid = new Float32Array(bw * bh)
  for (let y = 0; y < height; y++) {
    const row = Math.floor(y / block) * bw
    for (let x = 0; x < width; x++) {
      const b = row + Math.floor(x / block)
      if (gray[y * width + x] > grid[b]) grid[b] = gray[y * width + x]
    }
  }

  // Two 3×3 mean passes smooth out blocks that were entirely covered by ink.
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(grid.length)
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        let sum = 0
        let n = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const yy = y + dy
            const xx = x + dx
            if (yy >= 0 && yy < bh && xx >= 0 && xx < bw) {
              sum += grid[yy * bw + xx]
              n++
            }
          }
        }
        next[y * bw + x] = sum / n
      }
    }
    grid = next
  }

  // Bilinear upsample from block centres.
  const out = new Float32Array(gray.length)
  for (let y = 0; y < height; y++) {
    const gy = Math.min(bh - 1, Math.max(0, (y + 0.5) / block - 0.5))
    const y0 = Math.floor(gy)
    const y1 = Math.min(bh - 1, y0 + 1)
    const fy = gy - y0
    for (let x = 0; x < width; x++) {
      const gx = Math.min(bw - 1, Math.max(0, (x + 0.5) / block - 0.5))
      const x0 = Math.floor(gx)
      const x1 = Math.min(bw - 1, x0 + 1)
      const fx = gx - x0
      const top = grid[y0 * bw + x0] * (1 - fx) + grid[y0 * bw + x1] * fx
      const bottom = grid[y1 * bw + x0] * (1 - fx) + grid[y1 * bw + x1] * fx
      out[y * width + x] = top * (1 - fy) + bottom * fy
    }
  }
  return out
}

/** Stretches the 1st–99th percentile range to full 0–255 (auto-levels). */
function stretchContrast(gray: Uint8ClampedArray): void {
  const hist = new Uint32Array(256)
  for (const v of gray) hist[v]++
  const cut = gray.length * 0.01
  let lo = 0
  let hi = 255
  let below = hist[0]
  while (lo < 254 && below < cut) below += hist[++lo]
  let above = hist[255]
  while (hi > lo + 1 && above < cut) above += hist[--hi]
  if (hi - lo < 32) return // nearly uniform image; stretching would only amplify noise
  const scale = 255 / (hi - lo)
  for (let i = 0; i < gray.length; i++) gray[i] = (gray[i] - lo) * scale
}

/** 3×3 unsharp-style sharpen on a single channel. */
function sharpen(gray: Uint8ClampedArray, width: number, height: number, amount = 0.6): Uint8ClampedArray {
  const out = new Uint8ClampedArray(gray)
  for (let y = 1; y < height - 1; y++) {
    const row = y * width
    for (let x = 1; x < width - 1; x++) {
      const i = row + x
      const neighbours = gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width]
      out[i] = gray[i] + amount * (4 * gray[i] - neighbours)
    }
  }
  return out
}

/** Grayscale → even out lighting → contrast stretch → sharpen, written back into the RGBA buffer in place. */
export function enhanceForOcr(rgba: Uint8ClampedArray, width: number, height: number): void {
  const gray = toGray(rgba)
  normalizeIllumination(gray, width, height)
  stretchContrast(gray)
  const sharp = sharpen(gray, width, height)
  for (let i = 0, j = 0; j < sharp.length; i += 4, j++) {
    rgba[i] = rgba[i + 1] = rgba[i + 2] = sharp[j]
    rgba[i + 3] = 255
  }
}
