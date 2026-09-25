const NUMERIC_RE = /^[-+(]?[$€£₹¥]?\s?\d[\d,.]*%?\)?$/

/** Loose check for "looks like a number / amount" (used for header detection). */
export function isNumericLike(value: string): boolean {
  return NUMERIC_RE.test(value.trim())
}

/**
 * Strict check for values that are safe to store as Excel numbers without
 * losing information (no leading zeros, currency symbols or percent signs).
 */
export function toExcelNumber(value: string): number | null {
  const v = value.trim()
  if (!/^-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(v)) return null
  const digits = v.replace(/^-/, '')
  if (digits.length > 1 && digits.startsWith('0') && !digits.startsWith('0.')) return null
  if (digits.replace(/\D/g, '').length > 15) return null // beyond double precision
  const n = Number(v.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/** True when a line carries no real content (e.g. OCR noise like "—" or "|"). */
export function isNoiseLine(line: string): boolean {
  return !/[\p{L}\p{N}]/u.test(line)
}

export function createHeaders(count: number, start = 1): string[] {
  return Array.from({ length: count }, (_, i) => `Column ${i + start}`)
}
