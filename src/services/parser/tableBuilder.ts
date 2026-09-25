import type { Cell, TableData } from '../../types'
import { createHeaders, isNumericLike } from '../../utils/text'
import { parseNumeric } from '../ocrEnsemble'

const isFilled = (c: Cell | undefined) => !!c && c.value.trim().length > 0

export interface BuiltTable extends TableData {
  /** Rows above the detected header (titles, store names…) left out of the table. */
  skippedRows: number
}

/** How many of the first rows may be the header when title rows are skipped. */
const HEADER_SEARCH_ROWS = 3

export interface BuildOptions {
  detectHeader?: boolean
  /**
   * Photo layouts only: allow title rows above the header to be left out, and apply
   * OCR clean-up (misread "%" repair, outlier flags). Never used for user-typed text.
   */
  skipTitles?: boolean
}

/**
 * Pads ragged rows, removes empty rows/columns, finds the header row (skipping any
 * title rows above it), merges a two-line header and fixes misread "%" signs.
 */
export function buildTable(rawRows: Cell[][], { detectHeader = true, skipTitles = false }: BuildOptions = {}): BuiltTable {
  const width = Math.max(1, ...rawRows.map((r) => r.length))
  let rows = rawRows
    .map((r) => Array.from({ length: width }, (_, i) => r[i] ?? { value: '' }))
    .filter((r) => r.some(isFilled))

  const keepCols = Array.from({ length: width }, (_, c) => rows.some((r) => isFilled(r[c])))
  if (keepCols.some((k) => !k) && keepCols.some(Boolean)) {
    rows = rows.map((r) => r.filter((_, c) => keepCols[c]))
  }
  const colCount = rows[0]?.length ?? 1

  const headerAt = detectHeader ? findHeaderRow(rows, skipTitles ? HEADER_SEARCH_ROWS : 1) : -1
  // OCR-specific clean-up only applies to photo layouts, never to text the user typed.
  const clean = (body: Cell[][]) => (skipTitles ? flagColumnOutliers(fixPercentColumns(body)) : body)
  if (headerAt === -1) return { headers: createHeaders(colCount), rows: clean(rows), skippedRows: 0 }

  let head = rows[headerAt]
  let body = rows.slice(headerAt + 1)
  // Two-line headers ("PER SERVING" under "% DAILY INTAKE") are common on labels and invoices.
  if (body.length > 1 && isHeaderLike(body[0]) && hasNumbers(body.slice(1))) {
    head = head.map((c, i) => ({ value: [c.value, body[0][i].value].filter((v) => v.trim()).join(' ') }))
    body = body.slice(1)
  }
  const headers = head.map((c, i) => c.value.trim() || `Column ${i + 1}`)
  return { headers, rows: clean(body), skippedRows: headerAt }
}

function isHeaderLike(row: Cell[]): boolean {
  const filled = row.filter(isFilled)
  return filled.length >= Math.ceil(row.length / 2) && !filled.some((c) => isNumericLike(c.value)) && !filled.some((c) => c.value.length > 40)
}

const hasNumbers = (rows: Cell[][]) => rows.some((r) => r.some((c) => isFilled(c) && isNumericLike(c.value)))

/** Index of the header row among the first few rows, or -1. Prefers the most complete candidate. */
function findHeaderRow(rows: Cell[][], searchRows: number): number {
  let best = -1
  let bestFilled = 0
  for (let i = 0; i < Math.min(searchRows, rows.length - 1); i++) {
    if (!looksLikeHeader(rows.slice(i))) continue
    const filled = rows[i].filter(isFilled).length
    if (filled > bestFilled) {
      best = i
      bestFilled = filled
    }
  }
  return best
}

function looksLikeHeader(rows: Cell[][]): boolean {
  const [first, ...body] = rows
  if (!isHeaderLike(first)) return false
  const filled = first.filter(isFilled)

  // Strong signal: body has numeric values in a column whose header cell is text.
  const numericBelowText = first.some(
    (c, col) => isFilled(c) && body.some((r) => isFilled(r[col]) && isNumericLike(r[col].value)),
  )
  if (numericBelowText) return true

  // Weaker signal for all-text tables: a complete, short first row.
  return filled.length === first.length && rows.length >= 3 && filled.every((c) => c.value.length <= 25)
}

const PERCENT_RE = /^\d[\d.,]*\s?%$/
// How OCR commonly misreads a trailing "%" ("3h", "12Y", "5°/o").
const MISREAD_PERCENT_RE = /^(\d[\d.,]*)\s?(?:h|Y|Yo|%o|o\/o|°\/o|\/o)$/

/**
 * In columns that are mostly percentages, repairs cells whose digits are real but
 * whose "%" was misread. Repaired cells are flagged for review, never silently changed.
 */
function fixPercentColumns(rows: Cell[][]): Cell[][] {
  const width = rows[0]?.length ?? 0
  const percentCols = new Set<number>()
  for (let c = 0; c < width; c++) {
    const values = rows.map((r) => r[c]?.value.trim()).filter(Boolean)
    const percents = values.filter((v) => PERCENT_RE.test(v)).length
    // Low bar on purpose: only cells with genuine digits are touched, and they get flagged.
    if (percents >= 3 && percents / values.length >= 0.3) percentCols.add(c)
  }
  if (percentCols.size === 0) return rows
  return rows.map((r) =>
    r.map((cell, c) => {
      const m = percentCols.has(c) ? MISREAD_PERCENT_RE.exec(cell.value.trim()) : null
      return m ? { value: `${m[1]}%`, uncertain: true } : cell
    }),
  )
}

/**
 * Flags (never changes) values that don't fit their column: text in a numeric column,
 * a leading-zero number ("00mg"), or a number without a decimal point where nearly
 * all others with the same unit have one ("15g" among "0.9g", "3.8g"…). OCR can be confidently wrong; this catches the common cases.
 */
function flagColumnOutliers(rows: Cell[][]): Cell[][] {
  const width = rows[0]?.length ?? 0
  const flags = rows.map((r) => r.map(() => false))
  for (let c = 0; c < width; c++) {
    const filled = rows.map((r, i) => ({ i, v: r[c]?.value.trim() ?? '' })).filter((x) => x.v)
    const numeric = filled.filter((x) => parseNumeric(x.v))
    if (filled.length < 3 || numeric.length / filled.length < 0.6) continue
    // Decimal expectations are per unit: "770mg" is normal next to "0.9g" values.
    const unitOf = (v: string) => parseNumeric(v)?.unit.toLowerCase() ?? ''
    const decimalsExpected = new Set<string>()
    for (const unit of new Set(numeric.map((x) => unitOf(x.v)))) {
      const same = numeric.filter((x) => unitOf(x.v) === unit)
      if (same.length >= 3 && same.filter((x) => x.v.includes('.')).length / same.length >= 0.6) decimalsExpected.add(unit)
    }
    for (const { i, v } of filled) {
      const n = parseNumeric(v)
      if (!n || /^0\d/.test(n.core) || (decimalsExpected.has(n.unit.toLowerCase()) && !v.includes('.'))) flags[i][c] = true
    }
  }
  return rows.map((r, i) => r.map((cell, c) => (flags[i][c] && !cell.uncertain ? { ...cell, uncertain: true } : cell)))
}

export function textCell(value: string): Cell {
  return { value: value.trim() }
}
