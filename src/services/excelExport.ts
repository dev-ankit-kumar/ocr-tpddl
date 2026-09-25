import type { TableData } from '../types'
import { formatDateStamp } from '../utils/date'
import { toExcelNumber } from '../utils/text'

export function excelFileName(date = new Date()): string {
  return `document-data-${formatDateStamp(date)}.xlsx`
}

type SheetValue = string | number

function toSheetRows(table: TableData): SheetValue[][] {
  const body = table.rows.map((row) => row.map((cell) => toExcelNumber(cell.value) ?? cell.value))
  return [table.headers, ...body]
}

function columnWidths(rows: SheetValue[][]): { wch: number }[] {
  const width = Math.max(0, ...rows.map((r) => r.length))
  return Array.from({ length: width }, (_, c) => ({
    wch: Math.min(60, Math.max(8, ...rows.map((r) => String(r[c] ?? '').length + 2))),
  }))
}

/**
 * Builds and downloads an .xlsx file in the browser. SheetJS is loaded on demand
 * so it doesn't weigh down the initial page load.
 */
export async function downloadExcel(table: TableData, rawText?: string): Promise<string> {
  const { utils, writeFile } = await import('xlsx')
  const rows = toSheetRows(table)
  const sheet = utils.aoa_to_sheet(rows)
  sheet['!cols'] = columnWidths(rows)
  if (rows.length > 1 && table.headers.length > 0) {
    sheet['!autofilter'] = { ref: utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: table.headers.length - 1 } }) }
  }

  const workbook = utils.book_new()
  utils.book_append_sheet(workbook, sheet, 'Extracted Data')

  if (rawText?.trim()) {
    const rawSheet = utils.aoa_to_sheet([['Raw OCR text'], ...rawText.split(/\r?\n/).map((line) => [line])])
    rawSheet['!cols'] = [{ wch: 100 }]
    utils.book_append_sheet(workbook, rawSheet, 'Raw Text')
  }

  const fileName = excelFileName()
  writeFile(workbook, fileName, { compression: true })
  return fileName
}
