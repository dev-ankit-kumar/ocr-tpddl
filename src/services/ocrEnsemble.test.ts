import { describe, expect, it } from 'vitest'
import type { OcrWord } from '../types'
import { chooseReading, combineEngines, parseNumeric } from './ocrEnsemble'

const word = (text: string, confidence = 90, x = 0): OcrWord => ({ text, confidence, bbox: { x0: x, y0: 0, x1: x + 60, y1: 20 } })

describe('parseNumeric', () => {
  it('splits prefix, core and unit', () => {
    expect(parseNumeric('$1,200.50')).toEqual({ prefix: '$', core: '1,200.50', unit: '' })
    expect(parseNumeric('565kJ')).toEqual({ prefix: '', core: '565', unit: 'kJ' })
    expect(parseNumeric('12%')).toEqual({ prefix: '', core: '12', unit: '%' })
  })

  it('rejects words and unknown suffixes', () => {
    expect(parseNumeric('Apollo')).toBeNull()
    expect(parseNumeric('565k)')).toBeNull()
    expect(parseNumeric('INV-4471')).toBeNull()
  })

  it('fixes digit look-alikes only when asked', () => {
    expect(parseNumeric('IZ%')).toBeNull()
    expect(parseNumeric('IZ%', true)?.core).toBe('12')
    expect(parseNumeric('I.5g', true)).toMatchObject({ prefix: '', core: '1.5', unit: 'g' })
    expect(parseNumeric('O', true)).toBeNull()
  })
})

describe('chooseReading', () => {
  it.each([
    // [lstm, legacy, expected]
    ['15g', 'I.5g', '1.5g'], // decimal point recovered
    ['85g', '8.5g', '8.5g'],
    ['390', '33.9g', '33.9g'], // legacy kept the unit
    ['150g', '15.09', '15.0g'], // trailing g read as 9…
    ['259', '25g', '25g'], // …by either engine
    ['12%', 'IZ%', '12%'],
    ['2260kJ', 'ZZOOkJ', '2260kJ'], // look-alike guesses defer to LSTM digits
    ['2250kJ', '2Z60kJ', '2260kJ'], // …but the legacy's genuine digits are kept
    ['1350mg', 'l35llmg', '1350mg'],
    ['3h', '3%', '3%'],
    ['Apollo', 'Apo11o', 'Apollo'], // words always come from the LSTM engine
    ['0il', 'Oil', '0il'], // no real digit in the legacy reading: not a number
  ])('%s + %s → %s', (lstm, legacy, expected) => {
    expect(chooseReading(word(lstm), word(legacy))).toBe(expected)
  })

  it('prefers a confident legacy word when the LSTM engine is unsure', () => {
    expect(chooseReading(word('0il', 52), word('Oil', 88))).toBe('Oil')
    expect(chooseReading(word('|', 0), word('1', 87))).toBe('1')
    expect(chooseReading(word('Apollo', 95), word('Apo11o', 90))).toBe('Apollo')
  })
})

describe('combineEngines', () => {
  it('merges overlapping words and adds legacy-only numbers', () => {
    const lstm = [{ bbox: { x0: 0, y0: 0, x1: 200, y1: 20 }, words: [word('Protein', 95, 0), word('15g', 90, 100)] }]
    const legacy = [{ bbox: { x0: 0, y0: 0, x1: 400, y1: 20 }, words: [word('Protein', 80, 0), word('I.5g', 80, 100), word('5.9g', 80, 300)] }]
    const merged = combineEngines(lstm, legacy)
    expect(merged.flatMap((l) => l.words.map((w) => w.text))).toEqual(['Protein', '1.5g', '5.9g'])
  })
})
