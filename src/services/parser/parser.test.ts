import { describe, expect, it } from 'vitest'
import type { OcrLine, OcrWord } from '../../types'
import { toExcelNumber } from '../../utils/text'
import { parseOcrResult, parseLayout, parseText } from '.'

const CHAR_W = 14
const HEIGHT = 30

/** Builds an OCR line from [text, x] cells; multi-word cells get normal word spacing. */
function line(y: number, cells: [string, number][], confidence = 95): OcrLine {
  const words: OcrWord[] = []
  for (const [text, x] of cells) {
    let cursor = x
    for (const word of text.split(' ')) {
      const w = word.length * CHAR_W
      words.push({ text: word, confidence, bbox: { x0: cursor, y0: y, x1: cursor + w, y1: y + HEIGHT } })
      cursor += w + 10 // ~⅓ of the text height: an ordinary space
    }
  }
  return { words, bbox: { x0: words[0].bbox.x0, y0: y, x1: words.at(-1)!.bbox.x1, y1: y + HEIGHT } }
}

const values = (rows: { value: string }[][]) => rows.map((r) => r.map((c) => c.value))

describe('parseLayout', () => {
  it('detects columns, header and rows from word positions', () => {
    const lines = [
      line(0, [['ACME Store Receipt', 100]]),
      line(50, [['Item', 100], ['Qty', 500], ['Price', 700]]),
      line(100, [['Green apples', 100], ['2', 500], ['3.50', 700]]),
      line(150, [['Bread', 100], ['1', 500], ['2.25', 700]]),
      line(200, [['Orange juice 1L', 100], ['3', 500], ['12.00', 700]], 40),
    ]
    const result = parseLayout(lines)
    expect(result.structured).toBe(true)
    expect(result.table.headers).toEqual(['Item', 'Qty', 'Price'])
    expect(values(result.table.rows)).toEqual([
      ['Green apples', '2', '3.50'],
      ['Bread', '1', '2.25'],
      ['Orange juice 1L', '3', '12.00'],
    ])
    expect(result.table.rows[2].every((c) => c.uncertain)).toBe(true)
    expect(result.description).toMatch(/1 line\(s\) outside/)
  })

  it('treats ruling pipes as column separators', () => {
    const lines = [
      line(0, [['Name |', 100], ['| Age', 190]]),
      line(50, [['Ann |', 100], ['| 31', 190]]),
      line(100, [['Bob |', 100], ['| 42', 190]]),
    ]
    const result = parseLayout(lines)
    expect(result.table.headers).toEqual(['Name', 'Age'])
    expect(values(result.table.rows)).toEqual([['Ann', '31'], ['Bob', '42']])
  })

  it('does not invent a table from a paragraph', () => {
    const lines = [
      line(0, [['The quick brown fox jumps over', 100]]),
      line(50, [['the lazy dog and keeps running', 100]]),
      line(100, [['until the end of the page.', 100]]),
    ]
    expect(parseLayout(lines).structured).toBe(false)
  })
})

describe('parseText', () => {
  it('splits on multiple spaces and detects a header', () => {
    const text = 'Product    Units   Total\nWidget     4       1,200.50\nGadget     10      300'
    const result = parseText(text)
    expect(result.method).toBe('delimiter')
    expect(result.table.headers).toEqual(['Product', 'Units', 'Total'])
    expect(values(result.table.rows)).toEqual([['Widget', '4', '1,200.50'], ['Gadget', '10', '300']])
  })

  it('keeps thousands separators when splitting on commas', () => {
    const result = parseText('city,population\nParis,2,102,650\nLyon,522,250', 'comma')
    expect(values(result.table.rows)).toEqual([['Paris', '2,102,650'], ['Lyon', '522,250']])
  })

  it('parses markdown-style pipe tables', () => {
    const result = parseText('| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |')
    expect(result.table.headers).toEqual(['a', 'b'])
    expect(values(result.table.rows)).toEqual([['1', '2'], ['3', '4']])
  })

  it('detects key-value pairs', () => {
    const result = parseText('Invoice No: 1042\nDate: 2026-09-01\nTotal: $99.00')
    expect(result.method).toBe('key-value')
    expect(result.table.headers).toEqual(['Field', 'Value'])
    expect(values(result.table.rows)).toEqual([
      ['Invoice No', '1042'],
      ['Date', '2026-09-01'],
      ['Total', '$99.00'],
    ])
  })

  it('falls back to one row per line for prose', () => {
    const result = parseText('Dear customer, thank you\nfor shopping with us today.\nSee you soon!')
    expect(result.structured).toBe(false)
    expect(result.method).toBe('lines')
    expect(result.table.rows).toHaveLength(3)
  })
})

describe('parseOcrResult', () => {
  it('uses the text parser when no word geometry is available', () => {
    const result = parseOcrResult({ text: 'a\tb\n1\t2\n3\t4', confidence: 90, lines: [] })
    expect(result.structured).toBe(true)
    expect(result.table.headers).toEqual(['a', 'b'])
  })
})

describe('toExcelNumber', () => {
  it.each([
    ['1,234.50', 1234.5],
    ['-42', -42],
    ['0.75', 0.75],
    ['007', null],
    ['$5', null],
    ['12%', null],
    ['1234567890123456', null],
  ])('%s → %s', (input, expected) => {
    expect(toExcelNumber(input)).toBe(expected)
  })
})
