import { FIELDS, type NameplateData } from './extractNameplate'

export const EXCEL_FILE_NAME = 'transformer-data.xlsx'
export const NOT_DETECTED = 'Not detected'

/** The sheet contents: a header row plus exactly one row per field. */
export function excelRows(data: NameplateData): (string | number)[][] {
  return [
    ['Field Name', 'Value'],
    ...FIELDS.map(({ key, label }) => {
      const value = data[key]
      if (value === null) return [label, NOT_DETECTED]
      // KVA and year are numbers in Excel; the serial stays text (leading zeros matter).
      return [label, key === 'kva' || key === 'year' ? Number(value) : value]
    }),
  ]
}

/** Builds and downloads transformer-data.xlsx in the browser (SheetJS, loaded on demand). */
export async function downloadExcel(data: NameplateData): Promise<void> {
  const { utils, writeFile } = await import('xlsx')
  const sheet = utils.aoa_to_sheet(excelRows(data))
  sheet['!cols'] = [{ wch: 16 }, { wch: 22 }]
  const workbook = utils.book_new()
  utils.book_append_sheet(workbook, sheet, 'Transformer')
  writeFile(workbook, EXCEL_FILE_NAME, { compression: true })
}
