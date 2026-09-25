import { describe, expect, it } from 'vitest'
import { extractNameplate, kvaFromRatings, planRereads, type OcrPhrase } from './extractNameplate'
import nucon from './__fixtures__/nucon-lines.json'
import vijai from './__fixtures__/vijai-lines.json'

// Fixtures: PaddleOCR output recorded from real nameplate photos.
const phrase = (text: string, x0: number, y0: number, x1: number, y1: number, confidence = 95): OcrPhrase => ({
  text,
  confidence,
  bbox: { x0, y0, x1, y1 },
})

describe('Nucon nameplate (clear photo)', () => {
  it('reads make, serial and kVA on the first pass and asks to zoom into the year box', () => {
    const first = extractNameplate(nucon)
    expect(first.make).toMatchObject({ value: 'NUCON', status: 'ok' })
    expect(first.serial).toMatchObject({ value: '95230', status: 'ok' })
    expect(first.kva).toMatchObject({ value: '315', status: 'ok', note: 'Confirmed by 11000 V × 16.53 A' })
    expect(first.year.status).toBe('missing')

    const plan = planRereads(nucon)
    expect(plan.map((p) => p.field)).toEqual(['year'])
    // The zoom region sits to the right of the "YEAR OF MFG." label, on its row
    // (starting at the label's end; detection boxes are padded, hence the tolerance).
    const label = nucon.find((l) => l.text.startsWith('YEAR OF MFG'))!
    const h = label.bbox.y1 - label.bbox.y0
    expect(plan[0].region.x).toBeGreaterThan(label.bbox.x1 - h)
    expect(plan[0].region.y).toBeLessThan(label.bbox.y0)
  })

  it('fills the year from the zoomed re-read', () => {
    const result = extractNameplate(nucon, { year: [phrase('2011', 530, 800, 630, 830, 92)] })
    expect(result.year).toMatchObject({ value: '2011', status: 'ok' })
  })
})

describe('Vijai nameplate (faded, stained photo)', () => {
  it('reads what it can and flags everything uncertain', () => {
    const result = extractNameplate(vijai, { year: [phrase('2007', 560, 806, 650, 832, 96)], serial: [phrase('1788820', 480, 870, 620, 905, 80)] })
    expect(result.year).toMatchObject({ value: '2007', status: 'check' }) // the plate pass read "2010"
    expect(result.year.note).toContain('2010')
    expect(result.serial.status).toBe('check')
    expect(result.make.status).toBe('missing')
    expect(result.kva.status).toBe('missing')
  })
})

describe('field parsing', () => {
  const plate = (lines: OcrPhrase[], rereads = {}) => extractNameplate(lines, rereads)

  it('joins serial digit groups and strips label remnants from zoomed reads', () => {
    const label = phrase('SERIAL NO', 10, 100, 120, 125)
    expect(plate([label, phrase('118 8820', 130, 98, 260, 127)]).serial.value).toBe('1188820')
    expect(plate([label], { serial: [phrase('NO 1188820', 100, 95, 260, 130, 90)] }).serial.value).toBe('1188820')
    expect(plate([label, phrase('NT1234/A', 130, 98, 260, 127)]).serial.value).toBe('NT1234/A')
  })

  it('fixes look-alike letters in numeric serials but flags them', () => {
    const result = plate([phrase('SERIAL NO 178S820', 10, 100, 260, 125, 90)])
    expect(result.serial).toMatchObject({ value: '1785820', status: 'check' })
  })

  it('accepts only plausible years', () => {
    const label = phrase('YEAR OF MFG.', 10, 100, 120, 125)
    expect(plate([label, phrase('2011', 130, 98, 200, 127)]).year.value).toBe('2011')
    expect(plate([label, phrase('2099', 130, 98, 200, 127)]).year.status).not.toBe('ok')
  })

  it('knows standard kVA ratings', () => {
    const label = phrase('KVA', 10, 100, 60, 125)
    expect(plate([label, phrase('315', 130, 98, 180, 127)]).kva).toMatchObject({ value: '315', status: 'ok' })
    expect(plate([label, phrase('317', 130, 98, 180, 127)]).kva.status).toBe('check')
  })

  it('does not take the customer for the manufacturer', () => {
    const result = plate([phrase('CUSTOMER NORTH DELHI POWER LIMITED', 10, 10, 300, 30), phrase('NUC0N SWITCHGEARS (P) LTD', 10, 400, 300, 430)])
    expect(result.make.value).toBe('NUCON')
  })
})

describe('kvaFromRatings', () => {
  it('derives kVA from rated voltage and current (√3·V·I)', () => {
    expect(kvaFromRatings([phrase('11000', 0, 0, 1, 1), phrase('16.53', 0, 0, 1, 1)])).toMatchObject({ kva: 315 })
    expect(kvaFromRatings([phrase('11000', 0, 0, 1, 1), phrase('3.31', 0, 0, 1, 1)])).toMatchObject({ kva: 63 })
    // 173 kVA is not a standard rating: no guess.
    expect(kvaFromRatings([phrase('11000', 0, 0, 1, 1), phrase('9.1', 0, 0, 1, 1)])).toBeNull()
  })
})
