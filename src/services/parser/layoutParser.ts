// Detects table columns from word positions: words separated by a wide gap form
// separate cells, and vertical whitespace "rivers" shared by most rows become
// column boundaries.
import type { Cell, OcrLine, OcrWord, ParseResult } from '../../types'
import { median } from '../../utils/stats'
import { buildTable } from './tableBuilder'

/** Words below this confidence are flagged for review. */
export const LOW_CONFIDENCE = 60

interface Span {
  text: string
  x0: number
  x1: number
  minConfidence: number
}

interface Column {
  x0: number
  x1: number
}

const PIPE_ONLY_RE = /^[|¦[\]]+$/
const EDGE_PIPES_RE = /^[|¦]+|[|¦]+$/g

function wordHeight(w: OcrWord): number {
  return w.bbox.y1 - w.bbox.y0
}

const centre = (w: OcrWord) => ({ x: (w.bbox.x0 + w.bbox.x1) / 2, y: (w.bbox.y0 + w.bbox.y1) / 2 })

/**
 * Text slope of one OCR line from a least-squares fit through its word centres
 * (more reliable on photos than Tesseract's own baseline). Null for lines too short to tell.
 */
function lineSlope(line: OcrLine, h: number): number | null {
  if (line.words.length < 2) return null
  const pts = line.words.map(centre)
  const span = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x))
  if (span < h * 5) return null
  const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length
  const my = pts.reduce((s, p) => s + p.y, 0) / pts.length
  let num = 0
  let den = 0
  for (const p of pts) {
    num += (p.x - mx) * (p.y - my)
    den += (p.x - mx) ** 2
  }
  return den > 0 ? num / den : null
}

/**
 * Rebuilds visual rows from individual words instead of trusting Tesseract's line
 * grouping, which breaks up table rows on rotated photos or multi-block layouts.
 * Word centres are deskewed using the median text slope, then clustered by y.
 */
export function groupIntoRows(lines: OcrLine[]): OcrWord[][] {
  const words = lines.flatMap((l) => l.words)
  const h = median(words.map(wordHeight))
  const slope = Math.max(-0.2, Math.min(0.2, median(lines.map((l) => lineSlope(l, h)).filter((s) => s !== null))))
  const tolerance = h * 0.5

  const placed = words
    .map((w) => {
      const c = centre(w)
      return { w, y: c.y - slope * c.x }
    })
    .sort((a, b) => a.y - b.y)

  const rows: { words: OcrWord[]; ySum: number }[] = []
  for (const { w, y } of placed) {
    const row = rows.at(-1)
    if (row && Math.abs(y - row.ySum / row.words.length) <= tolerance) {
      row.words.push(w)
      row.ySum += y
    } else {
      rows.push({ words: [w], ySum: y })
    }
  }
  return rows.map((r) => r.words.sort((a, b) => a.bbox.x0 - b.bbox.x0))
}

/** Splits one visual row into cells wherever the gap between words is wide or a ruling "|" appears. */
function splitLine(words: OcrWord[], gapThreshold: number): Span[] {
  const spans: Span[] = []
  let current: Span | null = null
  let forceBreak = false

  for (const word of words) {
    if (PIPE_ONLY_RE.test(word.text)) {
      forceBreak = true
      continue
    }
    const text = word.text.replace(EDGE_PIPES_RE, '')
    const breakBefore = forceBreak || /^[|¦]/.test(word.text)
    forceBreak = /[|¦]$/.test(word.text)
    if (!text) continue

    if (current && !breakBefore && word.bbox.x0 - current.x1 <= gapThreshold) {
      current.text += ` ${text}`
      current.x1 = Math.max(current.x1, word.bbox.x1)
      current.minConfidence = Math.min(current.minConfidence, word.confidence)
    } else {
      current = { text, x0: word.bbox.x0, x1: word.bbox.x1, minConfidence: word.confidence }
      spans.push(current)
    }
  }
  return spans
}

/** Column boundaries = x-ranges between gaps that (almost) no multi-cell row crosses. */
function findColumns(rows: Span[][], minGap: number): Column[] {
  const multi = rows.filter((r) => r.length >= 2)
  const left = Math.floor(Math.min(...multi.flat().map((s) => s.x0)))
  const right = Math.ceil(Math.max(...multi.flat().map((s) => s.x1)))
  const width = right - left + 1
  if (!Number.isFinite(width) || width <= 0) return []

  // Difference array → coverage count per x position.
  const diff = new Int32Array(width + 1)
  for (const row of multi) {
    for (const s of row) {
      diff[Math.floor(s.x0) - left]++
      diff[Math.ceil(s.x1) - left + 1]--
    }
  }
  const tolerance = Math.floor(multi.length * 0.15)
  const columns: Column[] = []
  let coverage = 0
  let colStart = -1
  let gapStart = -1

  for (let x = 0; x < width; x++) {
    coverage += diff[x]
    const isGap = coverage <= tolerance
    if (!isGap) {
      if (colStart === -1) colStart = x
      else if (gapStart !== -1 && x - gapStart >= minGap) {
        columns.push({ x0: colStart + left, x1: gapStart + left })
        colStart = x
      }
      gapStart = -1
    } else if (colStart !== -1 && gapStart === -1) {
      gapStart = x
    }
  }
  if (colStart !== -1) columns.push({ x0: colStart + left, x1: (gapStart === -1 ? width : gapStart) + left })
  return columns
}

function columnFor(span: Span, columns: Column[]): number {
  let best = 0
  let bestScore = -Infinity
  columns.forEach((col, i) => {
    const overlap = Math.min(span.x1, col.x1) - Math.max(span.x0, col.x0)
    // Negative overlap = distance, so non-overlapping spans still pick the nearest column.
    if (overlap > bestScore) {
      bestScore = overlap
      best = i
    }
  })
  return best
}

function placeRow(spans: Span[], columns: Column[]): Cell[] {
  const cells: Cell[] = columns.map(() => ({ value: '' }))
  for (const span of spans) {
    const cell = cells[columnFor(span, columns)]
    cell.value = cell.value ? `${cell.value} ${span.text}` : span.text
    if (span.minConfidence < LOW_CONFIDENCE) cell.uncertain = true
  }
  return cells
}

const NO_TABLE: ParseResult = {
  table: { headers: ['Column 1'], rows: [] },
  method: 'layout',
  confidence: 0,
  structured: false,
  description: 'No column layout detected.',
}

const hasContent = (words: OcrWord[]) => words.some((w) => /[\p{L}\p{N}]/u.test(w.text))

/** Deskewed rows split into cells, plus the typical text height (used as the gap unit). */
function rowsWithSpans(lines: OcrLine[]): { rows: Span[][]; h: number } {
  const rows = groupIntoRows(lines).filter(hasContent)
  const h = Math.max(8, median(rows.flat().map(wordHeight)))
  return { rows: rows.map((r) => splitLine(r, h)).filter((r) => r.length > 0), h }
}

/**
 * Plain-text rendering of the deskewed rows: cells separated by 4 spaces, so the
 * text parser's "multiple spaces" mode can re-split it after manual edits.
 */
export function layoutText(lines: OcrLine[]): string {
  return rowsWithSpans(lines)
    .rows.map((r) => r.map((s) => s.text).join('    '))
    .join('\n')
}

export function parseLayout(lines: OcrLine[]): ParseResult {
  const { rows: spanRows, h } = rowsWithSpans(lines)
  if (spanRows.length < 2) return NO_TABLE

  // The table region runs from the first to the last multi-cell row; titles/footers outside are skipped.
  const first = spanRows.findIndex((r) => r.length >= 2)
  const last = spanRows.findLastIndex((r) => r.length >= 2)
  if (first === -1 || first === last) return NO_TABLE
  const region = spanRows.slice(first, last + 1)

  const columns = findColumns(region, Math.max(3, h * 0.3))
  if (columns.length < 2) return NO_TABLE

  const cells = region.map((r) => placeRow(r, columns))
  const fill = median(cells.map((r) => r.filter((c) => c.value).length / columns.length))
  const multiShare = region.filter((r) => r.length >= 2).length / region.length
  const confidence = Math.min(1, fill * 0.6 + multiShare * 0.4) * (columns.length > 12 ? 0.6 : 1)

  const table = buildTable(cells)
  const skipped = spanRows.length - region.length
  const structured = confidence >= 0.55 && table.headers.length >= 2
  const extra = skipped ? ` ${skipped} line(s) outside the table are kept under "Raw text".` : ''

  return {
    table,
    method: 'layout',
    confidence,
    structured,
    description: `Detected ${table.headers.length} columns and ${table.rows.length} rows from the page layout.${extra}`,
  }
}
