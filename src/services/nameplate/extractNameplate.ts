// Finds the fields of a transformer nameplate (make, serial number, kVA, year of
// manufacture) in OCR output. Pure logic: the caller supplies OCR lines and, on a
// second call, re-reads of the value boxes this module asks for.
import type { BBox } from '../../types'
import type { CropRect } from '../../utils/imageFilters'
import { MAKERS } from './makers'

export interface OcrPhrase {
  text: string
  /** 0–100 */
  confidence: number
  bbox: BBox
}

export type NameplateField = 'make' | 'serial' | 'kva' | 'year'

export const FIELDS: { key: NameplateField; label: string }[] = [
  { key: 'make', label: 'Make' },
  { key: 'serial', label: 'Sr. No' },
  { key: 'kva', label: 'KVA' },
  { key: 'year', label: 'Year of Mfg' },
]

export type FieldStatus = 'ok' | 'check' | 'missing'

export interface FieldReading {
  value: string
  /** 0–100 */
  confidence: number
  status: FieldStatus
  /** Why a value needs checking, or how it was confirmed. */
  note?: string
}

export type NameplateReadings = Record<NameplateField, FieldReading>

export interface RereadRequest {
  field: NameplateField
  region: CropRect
}

/** Standard distribution/power transformer ratings (IS 1180 / IS 2026). */
export const STANDARD_KVA = [
  5, 10, 16, 25, 40, 50, 63, 75, 100, 125, 150, 160, 200, 250, 300, 315, 400, 500, 630, 750, 800, 990, 1000, 1250, 1500,
  1600, 2000, 2500, 3150, 4000, 5000,
]

/** Confidence at or above which a valid, uncontested value needs no review. */
const SURE = 85
const ZOOM_BONUS = 10

// ── Labels ────────────────────────────────────────────────────────────────────
// Matched on "compact" text (uppercase letters/digits only) and tolerant of common
// OCR slips, e.g. "YEAROP MFG", "PANUTACT" (MANUFACT), "TRF.SR.NO.", "SERIALNO".
const LABELS: Record<Exclude<NameplateField, 'make'>, RegExp> = {
  serial: /(?:SERIAL|SERL|SER|SR|SL)(?:NO|N0|NUMBER|NUM)|TRFSR/,
  year: /Y[EC]AR(?:[O0][FP])?(?:MFG|MFD|MANU|MAKE|MF)|MFGYEAR|YR(?:[O0]F)?MFG|[MPNH]?ANU[FT]?ACT/,
  kva: /^[KX]?VA$|^KVA|KVARATING|RATINGKVA|RATEDKVA/,
}

const compact = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
const height = (b: BBox) => b.y1 - b.y0

function sameRow(a: BBox, b: BBox): boolean {
  const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
  return overlap > 0.5 * Math.min(height(a), height(b))
}

/** Looks like a label (words) rather than a value (numbers, codes). */
const isLabelLike = (text: string) => /[A-Z]{4,}/i.test(text) && !/\d/.test(text)

// ── Value parsers ─────────────────────────────────────────────────────────────
interface Parsed {
  value: string
  valid: boolean
  /** Characters were corrected (look-alikes), so the value deserves a look. */
  corrected?: boolean
}

const DIGIT_LOOKALIKES: Record<string, string> = { O: '0', Q: '0', D: '0', I: '1', L: '1', '|': '1', S: '5', B: '8', Z: '2', G: '6' }

function parseSerial(text: string): Parsed | null {
  // A zoomed re-read can start on the tail of the label ("NO 1188820"): drop a leading
  // separate word of letters. Serials that start with letters ("NT1234") are kept.
  const withoutLabel = text.toUpperCase().replace(/^[^A-Z0-9]*[A-Z.]{1,4}[.:\s]+(?=\d)/, '')
  // Join digit groups split by spaces ("178 8820"), keep code characters.
  const token = withoutLabel.replace(/^[^A-Z0-9]+/, '').replace(/\s+/g, '').replace(/[^A-Z0-9/-]/g, '')
  if (!token) return null
  const digits = token.replace(/\D/g, '').length
  if (digits < 3) return null
  // Mostly-numeric serials: fix look-alike letters ("178S820" → "1785820").
  if (digits / token.length >= 0.7) {
    const fixed = [...token].map((c) => DIGIT_LOOKALIKES[c] ?? c).join('')
    if (fixed !== token) return { value: fixed, valid: /^\d+$/.test(fixed), corrected: true }
  }
  return { value: token, valid: token.length >= 4 }
}

function parseYear(text: string): Parsed | null {
  const now = new Date().getFullYear()
  const m = /(?:19[5-9]\d|20\d\d)/.exec(text.replace(/\s+/g, ''))
  if (m && Number(m[0]) <= now) return { value: m[0], valid: true }
  const partial = /\b(?:19|20)\d?\b/.exec(text)
  return partial ? { value: partial[0], valid: false } : null
}

function parseKva(text: string): Parsed | null {
  const m = /(\d{1,4}(?:\.\d+)?)/.exec(text.replace(/,/g, ''))
  if (!m) return null
  const n = Number(m[1])
  return { value: String(n), valid: STANDARD_KVA.includes(n) }
}

const PARSERS = { serial: parseSerial, year: parseYear, kva: parseKva }

// ── Candidates ────────────────────────────────────────────────────────────────
interface Candidate extends Parsed {
  confidence: number
  source: 'plate' | 'zoom'
}

interface LabelHit {
  phrase: OcrPhrase
  /** Text after the label inside the same OCR phrase ("SERIAL NO 1788820"). */
  inlineValue: string
  /** Where the label text ends (x), estimated from character positions. */
  labelEndX: number
}

function findLabel(field: keyof typeof LABELS, phrases: OcrPhrase[]): LabelHit | null {
  for (const phrase of phrases) {
    const c = compact(phrase.text)
    const m = LABELS[field].exec(c)
    if (!m) continue
    // Map the end of the label in compact text back onto the original text.
    let seen = 0
    let cut = phrase.text.length
    for (let i = 0; i < phrase.text.length; i++) {
      if (/[A-Z0-9]/i.test(phrase.text[i])) seen++
      if (seen === m.index + m[0].length) {
        cut = i + 1
        break
      }
    }
    const inlineValue = phrase.text.slice(cut).replace(/^[\s.:\-–]+/, '')
    const labelEndX = phrase.bbox.x0 + ((phrase.bbox.x1 - phrase.bbox.x0) * cut) / Math.max(1, phrase.text.length)
    return { phrase, inlineValue, labelEndX }
  }
  return null
}

/** Phrases to the right of the label on the same row, up to the next label. */
const centerX = (b: BBox) => (b.x0 + b.x1) / 2

/** Right of `label` on the same row; detection boxes are padded, so small overlaps are fine. */
function rightOf(p: BBox, label: BBox): boolean {
  return sameRow(p, label) && centerX(p) > label.x1 && p.x0 >= label.x1 - height(label) * 0.5
}

function valuePhrases(hit: LabelHit, phrases: OcrPhrase[]): OcrPhrase[] {
  const right = phrases
    .filter((p) => p !== hit.phrase && rightOf(p.bbox, hit.phrase.bbox))
    .sort((a, b) => a.bbox.x0 - b.bbox.x0)
  const stop = right.findIndex((p) => isLabelLike(p.text))
  return stop === -1 ? right : right.slice(0, stop)
}

/** The value box region beside a label, for a zoomed re-read. */
function valueRegion(field: keyof typeof LABELS, hit: LabelHit, phrases: OcrPhrase[]): CropRect {
  const b = hit.phrase.bbox
  const h = height(b)
  const nextLabel = phrases
    .filter((p) => p !== hit.phrase && sameRow(p.bbox, b) && p.bbox.x0 > hit.labelEndX + h && isLabelLike(p.text))
    .sort((a, c) => a.bbox.x0 - c.bbox.x0)[0]
  // Serial digits are often stamped wider apart than the label letters, so the
  // estimated label end can land inside the value: start a little before it. Other
  // values start just after the label (a label tail would confuse the read).
  const x = hit.labelEndX + (field === 'serial' ? -0.8 : 0.3) * h
  const end = nextLabel ? nextLabel.bbox.x0 - h * 0.2 : x + h * 9
  return { x, y: b.y0 - h * 0.35, width: Math.max(h, end - x), height: h * 1.7 }
}

function candidatesFor(field: keyof typeof LABELS, hit: LabelHit, phrases: OcrPhrase[], rereads: OcrPhrase[]): Candidate[] {
  const parse = PARSERS[field]
  const out: Candidate[] = []
  const add = (text: string, confidence: number, source: Candidate['source']) => {
    const parsed = parse(text)
    if (parsed) out.push({ ...parsed, confidence, source })
  }
  if (hit.inlineValue) add(hit.inlineValue, hit.phrase.confidence, 'plate')
  const right = valuePhrases(hit, phrases)
  if (right.length) {
    // Serial numbers are often split into several boxes ("9 5 2 3 0").
    const text = field === 'serial' ? right.map((p) => p.text).join(' ') : right[0].text
    add(text, Math.min(...(field === 'serial' ? right : right.slice(0, 1)).map((p) => p.confidence)), 'plate')
  }
  for (const r of rereads) add(r.text, r.confidence, 'zoom')
  return out
}

function choose(candidates: Candidate[]): FieldReading {
  if (candidates.length === 0) return { value: '', confidence: 0, status: 'missing', note: 'Not found — please type it in' }
  // Zoomed re-reads are close-ups of the value box, so they get a small head start.
  const score = (c: Candidate) => c.confidence + (c.source === 'zoom' ? ZOOM_BONUS : 0)
  const ranked = [...candidates].sort((a, b) => Number(b.valid) - Number(a.valid) || score(b) - score(a))
  const best = ranked[0]
  const rival = ranked.find((c) => c.valid && c.value !== best.value && c.confidence >= 60)
  let note: string | undefined
  if (!best.valid) note = 'Unusual value — please check'
  else if (rival) note = `Also read as "${rival.value}" — please check`
  else if (best.corrected) note = 'Some characters were unclear — please check'
  else if (best.confidence < SURE) note = 'Low recognition confidence — please check'
  return { value: best.value, confidence: best.confidence, status: note ? 'check' : 'ok', note }
}

// ── Make ──────────────────────────────────────────────────────────────────────
function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[b.length]
}

/** Customer/owner lines name the utility, not the manufacturer. */
const NOT_MAKER_RE = /CUSTOMER|PROPERTY|POWER\s*LIMITED|NDPL|BSES|DISCOM|TPDDL|PURCHASER|OWNER/i

function findMake(phrases: OcrPhrase[]): FieldReading {
  for (const phrase of phrases) {
    if (NOT_MAKER_RE.test(phrase.text)) continue
    const words = phrase.text.toUpperCase().split(/[^A-Z0-9&]+/).filter(Boolean)
    const joined = compact(phrase.text)
    for (const maker of MAKERS) {
      const exact = maker.keys.some((k) => joined.includes(k))
      const fuzzy = !exact && maker.keys.some((k) => k.length >= 5 && words.some((w) => Math.abs(w.length - k.length) <= 1 && editDistance(w, k) <= 1))
      if (exact || fuzzy) {
        const status: FieldStatus = exact && phrase.confidence >= SURE ? 'ok' : 'check'
        return { value: maker.name, confidence: phrase.confidence, status, note: status === 'check' ? `Read as "${phrase.text}" — please check` : undefined }
      }
    }
  }
  // Unknown manufacturer: the "... LTD / LIMITED / (P)" line that isn't the customer.
  const company = phrases.find((p) => /\b(?:LTD|LIMITED|PVT)\b|\(P\)/i.test(p.text) && !NOT_MAKER_RE.test(p.text))
  if (company) {
    const name = company.text.replace(/\s*(?:\(P\)|PVT\.?|PRIVATE)?\s*(?:LTD\.?|LIMITED)\.?.*$/i, '').trim()
    if (name) return { value: name, confidence: company.confidence, status: 'check', note: 'Manufacturer not in the known list — please check' }
  }
  return { value: '', confidence: 0, status: 'missing', note: 'Not found — please type it in' }
}

// ── kVA cross-check ───────────────────────────────────────────────────────────
const HV_VOLTS = [3300, 6600, 11000, 22000, 33000]
const LV_VOLTS = [400, 415, 433, 440]

/**
 * kVA implied by the plate's own rated voltage and current (√3·V·I), snapped to a
 * standard rating when within 3%. Transformer plates list HV/LV amps, so this is an
 * independent check on the kVA reading.
 */
export function kvaFromRatings(phrases: OcrPhrase[]): { kva: number; volts: number; amps: number } | null {
  const numbers = phrases.flatMap((p) => [...p.text.replace(/,/g, '').matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0])))
  const volts = numbers.filter((n) => HV_VOLTS.includes(n) || LV_VOLTS.includes(n))
  const amps = numbers.filter((n) => !Number.isInteger(n) && n > 0.5 && n < 5000)
  for (const v of volts) {
    for (const a of amps) {
      const s = (Math.sqrt(3) * v * a) / 1000
      const std = STANDARD_KVA.find((k) => Math.abs(s - k) / k <= 0.03)
      if (std) return { kva: std, volts: v, amps: a }
    }
  }
  return null
}

function checkKva(reading: FieldReading, phrases: OcrPhrase[]): FieldReading {
  const implied = kvaFromRatings(phrases)
  if (!implied) return reading
  const how = `${implied.volts} V × ${implied.amps} A`
  if (!reading.value) {
    return { value: String(implied.kva), confidence: 50, status: 'check', note: `Calculated from ${how} — please check the plate` }
  }
  if (Number(reading.value) === implied.kva) {
    return { ...reading, status: 'ok', note: `Confirmed by ${how}` }
  }
  return { ...reading, status: 'check', note: `Plate current (${how}) suggests ${implied.kva} kVA — please check` }
}

// ── Entry points ──────────────────────────────────────────────────────────────
/** Value regions worth re-reading zoomed in: fields that are missing or not certain. */
export function planRereads(phrases: OcrPhrase[]): RereadRequest[] {
  const first = extractNameplate(phrases)
  const requests: RereadRequest[] = []
  for (const field of ['serial', 'year', 'kva'] as const) {
    if (first[field].status === 'ok') continue
    const hit = findLabel(field, phrases)
    if (hit) requests.push({ field, region: valueRegion(field, hit, phrases) })
  }
  return requests
}

/** Reads the fields, optionally with zoomed re-reads of value boxes (see planRereads). */
export function extractNameplate(phrases: OcrPhrase[], rereads: Partial<Record<NameplateField, OcrPhrase[]>> = {}): NameplateReadings {
  const readField = (field: keyof typeof LABELS): FieldReading => {
    const hit = findLabel(field, phrases)
    return hit ? choose(candidatesFor(field, hit, phrases, rereads[field] ?? [])) : choose([])
  }
  return {
    make: findMake(phrases),
    serial: readField('serial'),
    kva: checkKva(readField('kva'), phrases),
    year: readField('year'),
  }
}
