import { describe, expect, it } from 'vitest'
import type { Cell } from '../../types'
import { mergePasses, type OcrPasses } from '../ocrService'
import { parseOcrResult } from '.'
import nutrition from './__fixtures__/nutrition-passes.json'
import receipt from './__fixtures__/receipt-passes.json'

// Raw OCR output recorded from real photos (both engines, all passes), so the merge
// and parsing rules are tested end to end without running Tesseract.
function extract(passes: unknown) {
  return parseOcrResult(mergePasses(passes as OcrPasses)).table
}

const norm = (s: string) => s.replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim().toLowerCase()

describe('real scans', () => {
  it('reads a photographed receipt exactly', () => {
    const table = extract(receipt)
    expect(table.headers).toEqual(['ITEM', 'QTY', 'AMOUNT'])
    expect(table.rows.map((r) => r.map((c) => c.value))).toEqual([
      ['Milk 1L', '2', '2.58'],
      ['Eggs 12pk', '1', '3.99'],
      ['Basmati Rice 5kg', '1', '11.49'],
      ['Tomatoes', '3', '2.07'],
      ['Olive Oil', '1', '8.25'],
      ['Paper Towels', '2', '6.98'],
      ['Greek Yogurt', '4', '5.16'],
      ['Coffee Beans', '1', '12.99'],
    ])
  })

  it('reads a crinkled, watermarked nutrition label and flags every mistake', () => {
    const expected = [
      ['ENERGY', '565kJ', '2260kJ', '6%'],
      ['PROTEIN', '1.5g', '5.9g', '3%'],
      ['FAT - TOTAL', '8.5g', '33.9g', '12%'],
      ['- SATURATED', '3.9g', '15.5g', '16%'],
      ['- TRANS', '0.0g', '0.0g', ''],
      ['- POLYUNSATURATED', '0.9g', '3.4g', ''],
      ['- MONOUNSATURATED', '3.8g', '15.0g', ''],
      ['CHOLESTEROL', '0.0mg', '0.0mg', ''],
      ['CARBOHYDRATE - TOTAL', '13.3g', '53.1g', '4%'],
      ['- SUGARS', '1.0g', '3.9g', '1.1%'],
      ['DIETARY FIBRE', '0.7g', '2.7g', '2%'],
      ['SODIUM', '193mg', '770mg', '8%'],
      ['POTASSIUM', '338mg', '1350mg', ''],
    ]
    const table = extract(nutrition)
    expect(table.headers).toEqual(['SERVING SIZE: 25g', 'PERSERVE', 'PER 100g', 'PER SERVING'])
    expect(table.rows).toHaveLength(expected.length)

    let correct = 0
    const unflaggedMistakes: string[] = []
    expected.forEach((row, r) =>
      row.forEach((want, c) => {
        const got: Cell = table.rows[r][c] ?? { value: '' }
        // Labels may lose a leading dash ("SUGARS"); values must match exactly.
        const ok = c === 0 ? norm(got.value).replace(/^-/, '') === norm(want).replace(/^-/, '') : got.value === want
        if (ok) correct++
        else if (!got.uncertain) unflaggedMistakes.push(`row ${r + 1} col ${c + 1}: "${got.value}" (expected "${want}")`)
      }),
    )
    expect(correct / (expected.length * 4)).toBeGreaterThanOrEqual(0.85)
    expect(unflaggedMistakes).toEqual([])
  })
})
