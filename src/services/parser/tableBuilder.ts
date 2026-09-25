import type { Cell, TableData } from '../../types'
import { createHeaders, isNumericLike } from '../../utils/text'

const isFilled = (c: Cell | undefined) => !!c && c.value.trim().length > 0

/** Pads ragged rows, removes empty rows/columns and decides whether row 0 is a header. */
export function buildTable(rawRows: Cell[][], detectHeader = true): TableData {
  const width = Math.max(1, ...rawRows.map((r) => r.length))
  let rows = rawRows
    .map((r) => Array.from({ length: width }, (_, i) => r[i] ?? { value: '' }))
    .filter((r) => r.some(isFilled))

  const keepCols = Array.from({ length: width }, (_, c) => rows.some((r) => isFilled(r[c])))
  if (keepCols.some((k) => !k) && keepCols.some(Boolean)) {
    rows = rows.map((r) => r.filter((_, c) => keepCols[c]))
  }
  const colCount = rows[0]?.length ?? 1

  if (detectHeader && rows.length > 1 && looksLikeHeader(rows)) {
    const [head, ...body] = rows
    const headers = head.map((c, i) => c.value.trim() || `Column ${i + 1}`)
    return { headers, rows: body }
  }
  return { headers: createHeaders(colCount), rows }
}

function looksLikeHeader(rows: Cell[][]): boolean {
  const [first, ...body] = rows
  const filled = first.filter(isFilled)
  if (filled.length < Math.ceil(first.length / 2)) return false
  if (filled.some((c) => isNumericLike(c.value))) return false
  if (filled.some((c) => c.value.length > 40)) return false

  // Strong signal: body has numeric values in a column whose header cell is text.
  const numericBelowText = first.some(
    (c, col) => isFilled(c) && body.some((r) => isFilled(r[col]) && isNumericLike(r[col].value)),
  )
  if (numericBelowText) return true

  // Weaker signal for all-text tables: a complete, short first row.
  return filled.length === first.length && rows.length >= 3 && filled.every((c) => c.value.length <= 25)
}

export function textCell(value: string): Cell {
  return { value: value.trim() }
}
