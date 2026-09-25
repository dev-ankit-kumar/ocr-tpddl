import type { RegisterRecord } from '../../hooks/useRegister'
import { formatDateStamp } from '../../utils/date'
import type { NameplateField } from './extractNameplate'

const BRAND = 'FF0F766E'
const STRIPE = 'FFF0FDFA'
const UNVERIFIED = 'FFFEF3C7'
const BORDER = { style: 'thin' as const, color: { argb: 'FFCBD5E1' } }

const COLUMNS: { header: string; key: 'index' | NameplateField; width: number; numeric?: boolean }[] = [
  { header: 'S. No', key: 'index', width: 8, numeric: true },
  { header: 'Make', key: 'make', width: 28 },
  { header: 'Sr. No', key: 'serial', width: 18 },
  { header: 'KVA', key: 'kva', width: 10, numeric: true },
  { header: 'Year of Mfg', key: 'year', width: 14, numeric: true },
]

export function registerFileName(date = new Date()): string {
  return `transformer-register-${formatDateStamp(date)}.xlsx`
}

/** Numbers stay numbers in Excel (sortable, summable); anything else stays as typed. */
function cellValue(key: (typeof COLUMNS)[number]['key'], record: RegisterRecord, index: number): string | number {
  if (key === 'index') return index + 1
  const value = record[key].trim()
  if ((key === 'kva' || key === 'year') && /^\d+(\.\d+)?$/.test(value)) return Number(value)
  return value
}

/**
 * Builds a formatted .xlsx of the register in the browser: title, bold coloured
 * header, borders, zebra rows, frozen header, filters, and unverified values
 * highlighted with a note. ExcelJS is loaded only when the user downloads.
 */
export async function downloadRegister(records: RegisterRecord[]): Promise<string> {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'SnapSheet'
  workbook.created = new Date()
  const sheet = workbook.addWorksheet('Nameplates', {
    views: [{ state: 'frozen', ySplit: 3 }],
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '3:3' },
  })
  sheet.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width }))

  const last = String.fromCharCode(64 + COLUMNS.length)
  sheet.mergeCells(`A1:${last}1`)
  const title = sheet.getCell('A1')
  title.value = 'Transformer Nameplate Register'
  title.font = { bold: true, size: 14, color: { argb: BRAND } }
  sheet.getRow(1).height = 22

  sheet.mergeCells(`A2:${last}2`)
  const unverified = records.filter((r) => r.unverified.length).length
  const subtitle = sheet.getCell('A2')
  subtitle.value = `${records.length} transformer${records.length === 1 ? '' : 's'} · generated ${new Date().toLocaleString()}${
    unverified ? ` · ${unverified} with values to verify (highlighted)` : ''
  }`
  subtitle.font = { italic: true, size: 10, color: { argb: 'FF64748B' } }

  const header = sheet.getRow(3)
  COLUMNS.forEach((c, i) => {
    const cell = header.getCell(i + 1)
    cell.value = c.header
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } }
    cell.alignment = { vertical: 'middle', horizontal: c.numeric ? 'center' : 'left' }
    cell.border = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER }
  })
  header.height = 20

  records.forEach((record, i) => {
    const row = sheet.getRow(4 + i)
    COLUMNS.forEach((c, col) => {
      const cell = row.getCell(col + 1)
      cell.value = cellValue(c.key, record, i)
      cell.alignment = { vertical: 'middle', horizontal: c.numeric ? 'center' : 'left' }
      cell.border = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER }
      // Serial numbers are identifiers: always text, so leading zeros survive.
      if (c.key === 'serial') cell.numFmt = '@'
      const needsCheck = c.key !== 'index' && record.unverified.includes(c.key)
      const fill = needsCheck ? UNVERIFIED : i % 2 ? STRIPE : undefined
      if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
      if (needsCheck) cell.note = 'Not verified — please check against the nameplate'
    })
  })

  sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + records.length, column: COLUMNS.length } }

  const buffer = await workbook.xlsx.writeBuffer()
  const fileName = registerFileName()
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return fileName
}
