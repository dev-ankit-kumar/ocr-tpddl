import type { OcrResult, ParseResult } from '../../types'
import { parseLayout } from './layoutParser'
import { parseText } from './textParser'

export { parseText } from './textParser'
export { parseLayout } from './layoutParser'

/**
 * Picks the most plausible structure for an OCR result. Layout parsing uses word
 * positions (and flags low-confidence cells), so it gets a small preference.
 */
export function parseOcrResult(ocr: OcrResult): ParseResult {
  const layout = parseLayout(ocr.lines)
  const text = parseText(ocr.text, 'auto')

  const candidates = [layout, text].filter((c) => c.structured)
  // Auto text parsing falls back to one-row-per-line when nothing is structured.
  if (candidates.length === 0) return text

  const score = (c: ParseResult) => c.confidence + (c.method === 'layout' ? 0.05 : 0)
  return candidates.reduce((best, c) => (score(c) > score(best) ? c : best))
}
