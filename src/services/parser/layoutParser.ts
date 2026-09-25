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
  words: OcrWord[]
}

interface Column {
  x0: number
  x1: number
}

const PIPE_ONLY_RE = /^[|¦[\]]+$/
const EDGE_PIPES_RE = /^[|¦]+|[|¦]+$/g
/** Symbol-only tokens OCR produces from specks, creases and ruling lines ("~~", "—", "''"). */
const NOISE_RE = /^[~_=—–'"`.,:;^°•·‘’“”]+$/

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

    const cleaned = text === word.text ? word : { ...word, text }
    if (current && !breakBefore && word.bbox.x0 - current.x1 <= gapThreshold) {
      current.text += ` ${text}`
      current.x1 = Math.max(current.x1, word.bbox.x1)
      current.minConfidence = Math.min(current.minConfidence, word.confidence)
      current.words.push(cleaned)
    } else {
      current = { text, x0: word.bbox.x0, x1: word.bbox.x1, minConfidence: word.confidence, words: [cleaned] }
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

function columnFor(span: { x0: number; x1: number }, columns: Column[]): number {
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

/**
 * A span whose words sit in different columns (tightly spaced headers such as
 * "PER SERVE PER 100g") is split word by word instead of landing in one cell.
 */
function splitAcrossColumns(span: Span, columns: Column[]): { col: number; text: string; confidence: number }[] {
  const whole = [{ col: columnFor(span, columns), text: span.text, confidence: span.minConfidence }]
  // Column each word mostly sits in, or -1 when it lies in a gap between columns.
  const inside = span.words.map((w) => {
    let best = -1
    let bestOverlap = 0
    columns.forEach((c, i) => {
      const overlap = Math.min(w.bbox.x1, c.x1) - Math.max(w.bbox.x0, c.x0)
      if (overlap > bestOverlap) {
        best = i
        bestOverlap = overlap
      }
    })
    return best
  })
  // A long cell overflowing into the gap before the next column ("Basmati Rice 5kg")
  // has words in only one column and stays in one piece.
  if (new Set(inside.filter((c) => c !== -1)).size < 2) return whole
  // Words in a gap go with the next word that is in a column ("PER" + "100g").
  const cols = inside.map((c, i) => (c !== -1 ? c : (inside.slice(i + 1).find((x) => x !== -1) ?? inside.slice(0, i).findLast((x) => x !== -1)) as number))
  return span.words.map((w, i) => ({ col: cols[i], text: w.text, confidence: w.confidence }))
}

function placeRow(spans: Span[], columns: Column[]): Cell[] {
  const cells: Cell[] = columns.map(() => ({ value: '' }))
  for (const piece of spans.flatMap((s) => splitAcrossColumns(s, columns))) {
    const cell = cells[piece.col]
    cell.value = cell.value ? `${cell.value} ${piece.text}` : piece.text
    if (piece.confidence < LOW_CONFIDENCE) cell.uncertain = true
  }
  return cells
}

/**
 * The table region: the run of rows with the most multi-cell rows, allowing up to
 * two single-cell rows (wrapped text, sub-headings) inside it. Titles, footnotes
 * and watermarks outside the run are left out of the table.
 */
function tableRegion(rows: Span[][]): [number, number] | null {
  let best: [number, number] | null = null
  let bestCount = 0
  let start = -1
  let last = -1
  let count = 0
  const close = () => {
    if (count > bestCount) {
      best = [start, last]
      bestCount = count
    }
  }
  rows.forEach((row, i) => {
    if (row.length < 2) return
    if (start !== -1 && i - last > 3) {
      close()
      start = -1
    }
    if (start === -1) {
      start = i
      count = 0
    }
    last = i
    count++
  })
  if (start !== -1) close()
  return bestCount >= 2 ? best : null
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
  const clean = lines.map((l) => ({ ...l, words: l.words.filter((w) => !NOISE_RE.test(w.text)) }))
  const rows = groupIntoRows(clean).filter(hasContent)
  const h = Math.max(8, median(rows.flat().map(wordHeight)))
  const gap = cellGapThreshold(rows, h)
  return { rows: rows.map((r) => splitLine(r, gap)).filter((r) => r.length > 0), h }
}

/**
 * Gap that separates cells rather than words. Normally about one text height, but
 * monospaced print (receipts) has word spaces that wide, so the threshold also sits
 * clearly above the document's typical word space: the median of the in-row gaps
 * small enough to be spaces (column gaps are ignored so they can't skew it).
 */
function cellGapThreshold(rows: OcrWord[][], h: number): number {
  const spaces = rows
    .flatMap((r) => r.slice(1).map((w, i) => w.bbox.x0 - r[i].bbox.x1))
    .filter((g) => g > 0 && g < h * 1.5)
  return Math.max(h, median(spaces) * 1.4)
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

  const bounds = tableRegion(spanRows)
  if (!bounds) return NO_TABLE
  const region = spanRows.slice(bounds[0], bounds[1] + 1)

  const columns = findColumns(region, Math.max(3, h * 0.3))
  if (columns.length < 2) return NO_TABLE

  // A row holding one low-confidence fragment away from the label column is almost
  // always a watermark, crease or smudge rather than data.
  const isNoiseRow = (row: Cell[]) => {
    const filled = row.filter((c) => c.value)
    return filled.length === 1 && !row[0].value && filled[0].uncertain === true
  }
  const cells = region.map((r) => placeRow(r, columns)).filter((r) => !isNoiseRow(r))
  const fill = median(cells.map((r) => r.filter((c) => c.value).length / columns.length))
  const multiShare = region.filter((r) => r.length >= 2).length / region.length
  const confidence = Math.min(1, fill * 0.6 + multiShare * 0.4) * (columns.length > 12 ? 0.6 : 1)

  const { skippedRows, ...table } = buildTable(cells, { skipTitles: true })
  const skipped = spanRows.length - region.length + skippedRows
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
