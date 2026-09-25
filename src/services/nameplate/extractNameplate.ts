// Finds the four required fields of a transformer nameplate (KVA, Year of MFG,
// Manufacturer, Sr. No.) in OCR output. Pure logic: the caller supplies OCR phrases
// and, on a second call, zoomed re-reads of the value boxes this module asks for.
//
// A value is reported only when it is confidently detected; otherwise the field is
// left empty ("Not detected"). Nothing is ever guessed or invented.
import type { BBox, CropRect } from '../../types'
import { MAKERS } from './makers'

export interface OcrPhrase {
  text: string
  /** 0–100 */
  confidence: number
  bbox: BBox
}

export type NameplateField = 'kva' | 'year' | 'manufacturer' | 'serial'

/** The fields in output order, with their labels as shown and exported. */
export const FIELDS: { key: NameplateField; label: string }[] = [
  { key: 'kva', label: 'KVA' },
  { key: 'year', label: 'Year of MFG' },
  { key: 'manufacturer', label: 'Manufacturer' },
  { key: 'serial', label: 'Sr. No.' },
]

/** A confidently detected value, or null ("Not detected"). */
export type NameplateData = Record<NameplateField, string | null>

export interface RereadRequest {
  field: LabelledField
  region: CropRect
}

/** Standard distribution/power transformer ratings (IS 1180 / IS 2026). */
export const STANDARD_KVA = [
  5, 10, 16, 25, 40, 50, 63, 75, 100, 125, 150, 160, 200, 250, 300, 315, 400, 500, 630, 750, 800, 990, 1000, 1250, 1500,
  1600, 2000, 2500, 3150, 4000, 5000,
]

/** Minimum OCR confidence (0–100) for a valid, uncontested value to be reported. */
const MIN_CONFIDENCE = 75
/** Zoomed re-reads are close-ups of the value box, so they get a small head start. */
const ZOOM_BONUS = 10

// ── Labels ────────────────────────────────────────────────────────────────────
// Matched on "compact" text (uppercase letters/digits only), tolerant of common OCR
// slips: "K.V.A.", "YEAR OF MFG.", "YEAROP MFG", "PANUTACT" (MANUFACT), "TRF.SR.NO.",
// "SERIALNO", "SERIAL NUMBER".
type LabelledField = Exclude<NameplateField, 'manufacturer'>

const LABELS: Record<LabelledField, RegExp> = {
  serial: /(?:SERIAL|SERL|SER|SR|SL)(?:NO|N0|NUMBER|NUM)|TRFSR/,
  year: /Y[EC]AR(?:[O0][FP])?(?:MFG|MFD|MANU|MAKE|MF)|MFGYEAR|YR(?:[O0]F)?MFG|[MPNH]?ANU[FT]?ACT/,
  kva: /^[KX]?VA$|^KVA|KVARATING|RATINGKVA|RATEDKVA/,
}

const compact = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
const height = (b: BBox) => b.y1 - b.y0
const centerX = (b: BBox) => (b.x0 + b.x1) / 2

function sameRow(a: BBox, b: BBox): boolean {
  const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
  return overlap > 0.5 * Math.min(height(a), height(b))
}

/** Right of `label` on the same row; detection boxes are padded, so small overlaps are fine. */
function rightOf(p: BBox, label: BBox): boolean {
  return sameRow(p, label) && centerX(p) > label.x1 && p.x0 >= label.x1 - height(label) * 0.5
}

/** Looks like a label (words) rather than a value (numbers, codes). */
const isLabelLike = (text: string) => /[A-Z]{4,}/i.test(text) && !/\d/.test(text)

// ── Value parsers ─────────────────────────────────────────────────────────────
interface Parsed {
  value: string
  valid: boolean
  /** Look-alike letters had to be turned into digits: not certain enough to report. */
  corrected?: boolean
}

const DIGIT_LOOKALIKES: Record<string, string> = { O: '0', Q: '0', D: '0', I: '1', L: '1', '|': '1', S: '5', B: '8', Z: '2', G: '6' }

function parseSerial(text: string): Parsed | null {
  // A zoomed re-read can start on the tail of the label ("NO 1188820"): drop a leading
  // separate word of letters. Serials that start with letters ("NT1234") are kept.
  const withoutLabel = text.toUpperCase().replace(/^[^A-Z0-9]*[A-Z.]{1,4}[.:\s]+(?=\d)/, '')
  // Join digit groups split by spaces ("9 5 2 3 0"), keep code characters.
  const token = withoutLabel.replace(/^[^A-Z0-9]+/, '').replace(/\s+/g, '').replace(/[^A-Z0-9/-]/g, '')
  if (!token) return null
  const digits = token.replace(/\D/g, '').length
  if (digits < 3) return null
  if (digits / token.length >= 0.7 && /[A-Z|]/.test(token)) {
    const fixed = [...token].map((c) => DIGIT_LOOKALIKES[c] ?? c).join('')
    return { value: fixed, valid: /^\d+$/.test(fixed), corrected: true }
  }
  return { value: token, valid: token.length >= 4 }
}

function parseYear(text: string): Parsed | null {
  const m = /(?:19[5-9]\d|20\d\d)/.exec(text.replace(/\s+/g, ''))
  if (!m) return null
  return { value: m[0], valid: Number(m[0]) <= new Date().getFullYear() }
}

function parseKva(text: string): Parsed | null {
  const m = /(\d{1,4}(?:\.\d+)?)/.exec(text.replace(/,/g, ''))
  if (!m) return null
  const n = Number(m[1])
  return { value: String(n), valid: STANDARD_KVA.includes(n) }
}

const PARSERS: Record<LabelledField, (text: string) => Parsed | null> = { serial: parseSerial, year: parseYear, kva: parseKva }

// ── Label → value ─────────────────────────────────────────────────────────────
interface Candidate extends Parsed {
  confidence: number
  zoomed: boolean
}

interface LabelHit {
  phrase: OcrPhrase
  /** Text after the label inside the same OCR phrase ("SERIAL NO 1788820"). */
  inlineValue: string
  /** Where the label text ends (x), estimated from character positions. */
  labelEndX: number
}

function findLabel(field: LabelledField, phrases: OcrPhrase[]): LabelHit | null {
  for (const phrase of phrases) {
    const m = LABELS[field].exec(compact(phrase.text))
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
function valuePhrases(hit: LabelHit, phrases: OcrPhrase[]): OcrPhrase[] {
  const right = phrases.filter((p) => p !== hit.phrase && rightOf(p.bbox, hit.phrase.bbox)).sort((a, b) => a.bbox.x0 - b.bbox.x0)
  const stop = right.findIndex((p) => isLabelLike(p.text))
  return stop === -1 ? right : right.slice(0, stop)
}

/** The value box beside a label, to re-read zoomed in. */
function valueRegion(field: LabelledField, hit: LabelHit, phrases: OcrPhrase[]): CropRect {
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

function candidatesFor(field: LabelledField, hit: LabelHit, phrases: OcrPhrase[], rereads: OcrPhrase[]): Candidate[] {
  const parse = PARSERS[field]
  const out: Candidate[] = []
  const add = (text: string, confidence: number, zoomed: boolean) => {
    const parsed = parse(text)
    if (parsed) out.push({ ...parsed, confidence, zoomed })
  }
  if (hit.inlineValue) add(hit.inlineValue, hit.phrase.confidence, false)
  const right = valuePhrases(hit, phrases)
  if (right.length) {
    // Serial numbers are often split into several boxes ("9 5 2 3 0").
    const used = field === 'serial' ? right : right.slice(0, 1)
    add(used.map((p) => p.text).join(' '), Math.min(...used.map((p) => p.confidence)), false)
  }
  for (const r of rereads) add(r.text, r.confidence, true)
  return out
}

/** The best reading, if it is confident: valid, uncontested, not guessed, high enough confidence. */
function confident(candidates: Candidate[]): Candidate | null {
  const score = (c: Candidate) => c.confidence + (c.zoomed ? ZOOM_BONUS : 0)
  const ranked = candidates.filter((c) => c.valid).sort((a, b) => score(b) - score(a))
  const best = ranked[0]
  if (!best || best.corrected || best.confidence < MIN_CONFIDENCE) return null
  const rival = ranked.find((c) => c.value !== best.value && c.confidence >= 60)
  return rival ? null : best
}

// ── Manufacturer ──────────────────────────────────────────────────────────────
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

/** Customer/owner lines name the utility, never the manufacturer. */
const NOT_MAKER_RE = /CUSTOMER|PROPERTY|POWER\s*LIMITED|NDPL|BSES|DISCOM|TPDDL|PURCHASER|OWNER/i

function findManufacturer(phrases: OcrPhrase[]): string | null {
  const candidates = phrases.filter((p) => p.confidence >= MIN_CONFIDENCE && !NOT_MAKER_RE.test(p.text))
  for (const phrase of candidates) {
    const joined = compact(phrase.text)
    const words = phrase.text.toUpperCase().split(/[^A-Z0-9&]+/).filter(Boolean)
    for (const maker of MAKERS) {
      if (maker.keys.some((k) => joined.includes(k))) return maker.name
      // One misread letter in a long brand word ("NUC0N").
      if (maker.keys.some((k) => k.length >= 5 && words.some((w) => w.length === k.length && editDistance(w, k) <= 1))) return maker.name
    }
  }
  // A manufacturer not in the list: the clearly read "… LTD / LIMITED / (P)" line.
  const company = candidates.find((p) => p.confidence >= 85 && /\b(?:LTD|LIMITED|PVT)\b|\(P\)/i.test(p.text))
  const name = company?.text.replace(/\s*(?:\(P\)|PVT\.?|PRIVATE)?\s*(?:LTD\.?|LIMITED)\.?.*$/i, '').trim()
  return name || null
}

// ── kVA cross-check ───────────────────────────────────────────────────────────
const HV_VOLTS = [3300, 6600, 11000, 22000, 33000]
const LV_VOLTS = [400, 415, 433, 440]

/**
 * kVA implied by the plate's own rated voltage and current (√3·V·I), snapped to a
 * standard rating when within 3%. An independent check on the KVA reading.
 */
export function kvaFromRatings(phrases: OcrPhrase[]): number | null {
  const numbers = phrases.flatMap((p) => [...p.text.replace(/,/g, '').matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0])))
  const volts = numbers.filter((n) => HV_VOLTS.includes(n) || LV_VOLTS.includes(n))
  const amps = numbers.filter((n) => !Number.isInteger(n) && n > 0.5 && n < 5000)
  for (const v of volts) {
    for (const a of amps) {
      const s = (Math.sqrt(3) * v * a) / 1000
      const std = STANDARD_KVA.find((k) => Math.abs(s - k) / k <= 0.03)
      if (std) return std
    }
  }
  return null
}

// ── Entry points ──────────────────────────────────────────────────────────────
function readField(field: LabelledField, phrases: OcrPhrase[], rereads: OcrPhrase[] = []): string | null {
  const hit = findLabel(field, phrases)
  if (!hit) return null
  const candidates = candidatesFor(field, hit, phrases, rereads)
  if (field !== 'kva') return confident(candidates)?.value ?? null
  // KVA: a reading that matches the plate's own volts × amps is confirmed even at
  // moderate OCR confidence; a reading that contradicts it is not reported.
  const implied = kvaFromRatings(phrases)
  const matching = implied && candidates.find((c) => Number(c.value) === implied && c.confidence >= 50)
  if (matching) return matching.value
  const best = confident(candidates)
  return best && (implied === null || Number(best.value) === implied) ? best.value : null
}

/** Value boxes worth re-reading zoomed in: labelled fields not yet confidently read. */
export function planRereads(phrases: OcrPhrase[]): RereadRequest[] {
  const requests: RereadRequest[] = []
  for (const field of ['serial', 'year', 'kva'] as const) {
    if (readField(field, phrases) !== null) continue
    const hit = findLabel(field, phrases)
    if (hit) requests.push({ field, region: valueRegion(field, hit, phrases) })
  }
  return requests
}

/** Reads the four fields, optionally with zoomed re-reads of value boxes (see planRereads). */
export function extractNameplate(phrases: OcrPhrase[], rereads: Partial<Record<LabelledField, OcrPhrase[]>> = {}): NameplateData {
  return {
    kva: readField('kva', phrases, rereads.kva),
    year: readField('year', phrases, rereads.year),
    manufacturer: findManufacturer(phrases),
    serial: readField('serial', phrases, rereads.serial),
  }
}
