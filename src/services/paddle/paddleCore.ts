// Pure pre/post-processing for PaddleOCR (PP-OCRv4) models: no browser APIs, so it
// can be unit tested. Mirrors the reference pipeline, with axis-aligned boxes instead
// of OpenCV rotated rectangles (nameplate text is horizontal), which avoids a ~10 MB
// OpenCV dependency.
import type { BBox } from '../../types'

/** Detection input side is rounded up to a multiple of this (model requirement). */
export const DET_STRIDE = 32
/** Recognition input height (model requirement). */
export const REC_HEIGHT = 48

export interface Raster {
  data: Uint8ClampedArray // RGBA
  width: number
  height: number
}

/** RGBA pixels → planar BGR float tensor data scaled to 0–1 (the models' expected input). */
export function toBgrTensor({ data, width, height }: Raster): Float32Array {
  const plane = width * height
  const out = new Float32Array(plane * 3)
  for (let i = 0; i < plane; i++) {
    out[i] = data[i * 4 + 2] / 255
    out[plane + i] = data[i * 4 + 1] / 255
    out[plane * 2 + i] = data[i * 4] / 255
  }
  return out
}

/** Detection input size: longest side ≤ maxSide, both sides multiples of 32. */
export function detectionSize(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height))
  const round = (v: number) => Math.max(DET_STRIDE, Math.ceil((v * scale) / DET_STRIDE) * DET_STRIDE)
  return { width: round(width), height: round(height) }
}

export interface TextBox extends BBox {
  /** Mean text probability inside the region, 0–1. */
  score: number
}

/**
 * Text regions from the detection probability map: connected components of pixels
 * above `threshold`, each expanded ("unclipped") like the reference DB post-process,
 * in map coordinates.
 */
export function findTextBoxes(prob: Float32Array, width: number, height: number, threshold = 0.3, minScore = 0.5): TextBox[] {
  const seen = new Uint8Array(prob.length)
  const stack = new Int32Array(prob.length)
  const boxes: TextBox[] = []
  for (let start = 0; start < prob.length; start++) {
    if (seen[start] || prob[start] <= threshold) continue
    let top = 0
    stack[top++] = start
    seen[start] = 1
    let x0 = width
    let y0 = height
    let x1 = 0
    let y1 = 0
    let sum = 0
    let count = 0
    while (top > 0) {
      const i = stack[--top]
      const x = i % width
      const y = (i - x) / width
      sum += prob[i]
      count++
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      const push = (n: number) => {
        if (!seen[n] && prob[n] > threshold) {
          seen[n] = 1
          stack[top++] = n
        }
      }
      if (x > 0) push(i - 1)
      if (x < width - 1) push(i + 1)
      if (y > 0) push(i - width)
      if (y < height - 1) push(i + width)
    }
    const w = x1 - x0 + 1
    const h = y1 - y0 + 1
    const score = sum / count
    if (Math.min(w, h) < 3 || score < minScore) continue
    // Unclip: grow by area × 1.5 / perimeter, as in the DB reference implementation.
    const d = (w * h * 1.5) / (2 * (w + h))
    boxes.push({
      x0: Math.max(0, x0 - d),
      y0: Math.max(0, y0 - d),
      x1: Math.min(width, x1 + 1 + d),
      y1: Math.min(height, y1 + 1 + d),
      score,
    })
  }
  return boxes
}

export interface Decoded {
  text: string
  /** Mean character probability, 0–1. */
  confidence: number
}

/** Greedy CTC decoding of recognition output [1, T, C]; class 0 is the CTC blank. */
export function ctcDecode(logits: Float32Array, steps: number, classes: number, dictionary: string[]): Decoded {
  let text = ''
  let sum = 0
  let n = 0
  let prev = -1
  for (let t = 0; t < steps; t++) {
    let best = 0
    let bestP = -Infinity
    const base = t * classes
    for (let c = 0; c < classes; c++) {
      const p = logits[base + c]
      if (p > bestP) {
        bestP = p
        best = c
      }
    }
    if (best !== 0 && best !== prev) {
      text += dictionary[best - 1] ?? ''
      sum += bestP
      n++
    }
    prev = best
  }
  return { text, confidence: n ? sum / n : 0 }
}

/** The model's dictionary file plus the trailing space class. */
export function parseDictionary(file: string): string[] {
  return [...file.split(/\r?\n/), ' ']
}

/**
 * The recognition model knows thousands of CJK characters; nameplates here are in
 * English, so anything outside Latin text and common symbols is recognition noise.
 */
export function keepLatin(text: string): string {
  return text.replace(/[^\x20-\x7E°µ±Ω]/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * Contrast normalisation for faded, stained or glary metal plates: each pixel is
 * compared with its local mean and spread, which evens out lighting and makes faint
 * stamped text stand out. Output is grayscale RGBA.
 */
export function normalizeLocalContrast({ data, width, height }: Raster): Uint8ClampedArray<ArrayBuffer> {
  const n = width * height
  const gray = new Float64Array(n)
  for (let i = 0; i < n; i++) gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
  const stride = width + 1
  const sum = new Float64Array(stride * (height + 1))
  const sq = new Float64Array(stride * (height + 1))
  for (let y = 0; y < height; y++) {
    let rs = 0
    let rq = 0
    for (let x = 0; x < width; x++) {
      const v = gray[y * width + x]
      rs += v
      rq += v * v
      const k = (y + 1) * stride + x + 1
      sum[k] = sum[k - stride] + rs
      sq[k] = sq[k - stride] + rq
    }
  }
  const r = Math.max(8, Math.round(Math.max(width, height) / 40))
  const out = new Uint8ClampedArray(n * 4)
  for (let y = 0; y < height; y++) {
    const ya = Math.max(0, y - r)
    const yb = Math.min(height, y + r + 1)
    for (let x = 0; x < width; x++) {
      const xa = Math.max(0, x - r)
      const xb = Math.min(width, x + r + 1)
      const area = (xb - xa) * (yb - ya)
      const a = yb * stride + xb
      const b = ya * stride + xb
      const c = yb * stride + xa
      const d = ya * stride + xa
      const mean = (sum[a] - sum[b] - sum[c] + sum[d]) / area
      const variance = (sq[a] - sq[b] - sq[c] + sq[d]) / area - mean * mean
      const v = 128 + ((gray[y * width + x] - mean) / (Math.sqrt(Math.max(0, variance)) + 12)) * 60
      const i = (y * width + x) * 4
      out[i] = out[i + 1] = out[i + 2] = v
      out[i + 3] = 255
    }
  }
  return out
}
