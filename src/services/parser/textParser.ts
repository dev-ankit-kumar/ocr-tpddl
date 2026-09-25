import type { Cell, ParseResult, SplitMode } from '../../types'
import { mode } from '../../utils/stats'
import { isNoiseLine } from '../../utils/text'
import { buildTable, textCell } from './tableBuilder'

type Splitter = (line: string) => string[]

const KEY_VALUE_RE = /^([^:：]{1,60}?)\s*[:：]\s*(.*)$/
const MARKDOWN_RULE_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

const SPLITTERS: Record<Exclude<SplitMode, 'auto'>, Splitter> = {
  tab: (l) => l.split('\t'),
  pipe: (l) => l.replace(/^\s*[|¦]/, '').replace(/[|¦]\s*$/, '').split(/[|¦]/),
  // Don't split thousands separators such as 1,234 (digit, comma, exactly three digits).
  comma: (l) => l.split(/(?<!\d),|,(?!\d{3}(?:\D|$))/),
  semicolon: (l) => l.split(';'),
  'multi-space': (l) => l.trim().split(/\s{2,}|\t/),
  space: (l) => l.trim().split(/\s+/),
  'key-value': (l) => {
    const m = KEY_VALUE_RE.exec(l.trim())
    return m ? [m[1], m[2]] : [l]
  },
  lines: (l) => [l],
}

// Order matters: earlier modes win ties.
const AUTO_ORDER: Exclude<SplitMode, 'auto' | 'lines'>[] = ['key-value', 'tab', 'pipe', 'semicolon', 'comma', 'multi-space', 'space']

const MODE_LABELS: Record<Exclude<SplitMode, 'auto'>, string> = {
  tab: 'tabs',
  pipe: 'pipes (|)',
  comma: 'commas',
  semicolon: 'semicolons',
  'multi-space': 'multiple spaces',
  space: 'single spaces',
  'key-value': '"key: value" pairs',
  lines: 'lines (one column)',
}

export function contentLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() && !isNoiseLine(l) && !MARKDOWN_RULE_RE.test(l))
}

/** 0–1 score for how consistently `mode` splits the lines into ≥2 columns. */
function scoreMode(lines: string[], splitMode: Exclude<SplitMode, 'auto' | 'lines'>): number {
  if (lines.length < 2) return 0
  if (splitMode === 'key-value') {
    return lines.filter((l) => KEY_VALUE_RE.test(l.trim())).length / lines.length
  }
  const counts = lines.map((l) => SPLITTERS[splitMode](l).length)
  const multi = counts.filter((c) => c >= 2)
  if (multi.length < 2) return 0
  const modal = mode(multi)
  const consistency = counts.filter((c) => c === modal).length / lines.length
  const support = multi.length / lines.length
  const score = consistency * 0.7 + support * 0.3
  // Splitting on single spaces turns prose into noise, so demand near-perfect consistency.
  if (splitMode === 'space' && consistency < 0.8) return 0
  return score
}

function pickAutoMode(lines: string[]): { splitMode: Exclude<SplitMode, 'auto'>; score: number } {
  let best: { splitMode: Exclude<SplitMode, 'auto'>; score: number } = { splitMode: 'lines', score: 0 }
  for (const m of AUTO_ORDER) {
    const score = scoreMode(lines, m)
    if (score > best.score) best = { splitMode: m, score }
  }
  return best.score >= 0.6 ? best : { splitMode: 'lines', score: best.score }
}

/** Splits plain text into a table using an explicit or auto-detected separator. */
export function parseText(text: string, requested: SplitMode = 'auto'): ParseResult {
  const lines = contentLines(text)
  const { splitMode, score } =
    requested === 'auto'
      ? pickAutoMode(lines)
      : { splitMode: requested, score: requested === 'lines' ? 0 : scoreMode(lines, requested) }

  const rows: Cell[][] = lines.map((l) => SPLITTERS[splitMode](l).map(textCell))
  const isKeyValue = splitMode === 'key-value'
  const table = buildTable(rows, !isKeyValue && splitMode !== 'lines')
  if (isKeyValue && table.headers.length === 2) table.headers = ['Field', 'Value']

  const structured = splitMode !== 'lines' && score >= 0.6
  return {
    table,
    method: isKeyValue ? 'key-value' : splitMode === 'lines' ? 'lines' : 'delimiter',
    confidence: score,
    structured,
    description: describe(splitMode, table.rows.length, table.headers.length, requested === 'auto', structured),
  }
}

function describe(splitMode: Exclude<SplitMode, 'auto'>, rows: number, cols: number, auto: boolean, structured: boolean) {
  if (splitMode === 'lines') {
    return auto
      ? 'No clear table found, so each line became a row. Try a different split option under "Raw text".'
      : `Each line became a row (${rows} rows).`
  }
  if (splitMode === 'key-value') return `Found ${rows} "key: value" pairs.`
  const base = `Split by ${MODE_LABELS[splitMode]} into ${cols} columns and ${rows} rows.`
  return structured ? base : `${base} The columns look uneven, so please review carefully.`
}
