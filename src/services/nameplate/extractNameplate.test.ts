import { describe, expect, it } from 'vitest'
import { excelRows } from './excelExport'
import { extractNameplate, kvaFromRatings, planRereads, type OcrPhrase } from './extractNameplate'
import nucon from './__fixtures__/nucon-lines.json'
import vijai from './__fixtures__/vijai-lines.json'

// Fixtures: PaddleOCR output recorded from real nameplate photos.
const phrase = (text: string, x0: number, y0: number, x1: number, y1: number, confidence = 95): OcrPhrase => ({
  text,
  confidence,
  bbox: { x0, y0, x1, y1 },
})

describe('Nucon nameplate (reference photo)', () => {
  it('reads KVA, manufacturer and Sr. No. directly and asks to zoom into the year box', () => {
    expect(extractNameplate(nucon)).toEqual({ kva: '315', year: null, manufacturer: 'NUCON', serial: '95230' })
    const plan = planRereads(nucon)
    expect(plan.map((p) => p.field)).toEqual(['year'])
    const label = nucon.find((l) => l.text.startsWith('YEAR OF MFG'))!
    expect(plan[0].region.x).toBeGreaterThan(label.bbox.x1 - (label.bbox.y1 - label.bbox.y0))
  })

  it('gets all four fields with the zoomed re-read of the year', () => {
    expect(extractNameplate(nucon, { year: [phrase('2011', 530, 800, 630, 830, 92)] })).toEqual({
      kva: '315',
      year: '2011',
      manufacturer: 'NUCON',
      serial: '95230',
    })
  })
})

describe('Vijai nameplate (faded, stained photo)', () => {
  it('reports only what is certain and never guesses', () => {
    // The plate pass read the year as "2010" and the zoom as "2007": readings disagree.
    const result = extractNameplate(vijai, { year: [phrase('2007', 560, 806, 650, 832, 96)] })
    expect(result).toEqual({ kva: null, year: null, manufacturer: null, serial: null })
  })

  it('accepts the year when the readings agree', () => {
    const lines = vijai.map((l) => (l.text === '2010' ? { ...l, text: '2007' } : l))
    expect(extractNameplate(lines, { year: [phrase('2007', 560, 806, 650, 832, 96)] }).year).toBe('2007')
  })
})

describe('field rules', () => {
  const kva = phrase('KVA', 10, 100, 60, 125)
  it('KVA: standard ratings only, "K.V.A." label too', () => {
    expect(extractNameplate([kva, phrase('315', 130, 98, 180, 127)]).kva).toBe('315')
    expect(extractNameplate([phrase('K.V.A.', 10, 100, 70, 125), phrase('250', 130, 98, 180, 127)]).kva).toBe('250')
    expect(extractNameplate([kva, phrase('317', 130, 98, 180, 127)]).kva).toBeNull()
  })

  it('KVA: rejected when it contradicts the plate volts × amps', () => {
    const plate = [kva, phrase('250', 130, 98, 180, 127), phrase('11000', 10, 200, 80, 225), phrase('16.53', 10, 300, 80, 325)]
    expect(extractNameplate(plate).kva).toBeNull()
  })

  it('Year: labels "YEAR OF MANUFACTURE" / "MFG." and plausible years only', () => {
    expect(extractNameplate([phrase('YEAR OF MANUFACTURE', 10, 100, 200, 125), phrase('2007', 230, 98, 290, 127)]).year).toBe('2007')
    expect(extractNameplate([phrase('YEAR OF MFG.', 10, 100, 120, 125), phrase('2099', 130, 98, 200, 127)]).year).toBeNull()
  })

  it('Sr. No.: joins digit groups; unclear characters are not reported', () => {
    const label = phrase('SERIAL NO', 10, 100, 120, 125)
    expect(extractNameplate([label, phrase('118 8820', 130, 98, 260, 127)]).serial).toBe('1188820')
    expect(extractNameplate([label, phrase('NT1234/A', 130, 98, 260, 127)]).serial).toBe('NT1234/A')
    expect(extractNameplate([phrase('SERIAL NO 178S820', 10, 100, 260, 125, 90)]).serial).toBeNull()
    expect(extractNameplate([label], { serial: [phrase('NO 1188820', 100, 95, 260, 130, 90)] }).serial).toBe('1188820')
  })

  it('Manufacturer: never the customer; low-confidence text is not used', () => {
    const lines = [phrase('CUSTOMER NORTH DELHI POWER LIMITED', 10, 10, 300, 30), phrase('NUC0N SWITCHGEARS (P) LTD', 10, 400, 300, 430)]
    expect(extractNameplate(lines).manufacturer).toBe('NUCON')
    expect(extractNameplate([lines[0]]).manufacturer).toBeNull()
    expect(extractNameplate([phrase('NUCON', 10, 10, 90, 40, 50)]).manufacturer).toBeNull()
  })

  it('kvaFromRatings: √3·V·I snapped to a standard rating', () => {
    expect(kvaFromRatings([phrase('11000', 0, 0, 1, 1), phrase('16.53', 0, 0, 1, 1)])).toBe(315)
    expect(kvaFromRatings([phrase('11000', 0, 0, 1, 1), phrase('3.31', 0, 0, 1, 1)])).toBe(63)
    expect(kvaFromRatings([phrase('11000', 0, 0, 1, 1), phrase('9.1', 0, 0, 1, 1)])).toBeNull()
  })
})

describe('excelRows', () => {
  it('has exactly two columns and one row per field', () => {
    expect(excelRows({ kva: '315', year: '2011', manufacturer: 'NUCON', serial: '95230' })).toEqual([
      ['Field Name', 'Value'],
      ['KVA', 315],
      ['Year of MFG', 2011],
      ['Manufacturer', 'NUCON'],
      ['Sr. No.', '95230'],
    ])
  })

  it('writes "Not detected" for missing fields', () => {
    expect(excelRows({ kva: null, year: '2007', manufacturer: null, serial: null }).slice(1)).toEqual([
      ['KVA', 'Not detected'],
      ['Year of MFG', 2007],
      ['Manufacturer', 'Not detected'],
      ['Sr. No.', 'Not detected'],
    ])
  })
})
