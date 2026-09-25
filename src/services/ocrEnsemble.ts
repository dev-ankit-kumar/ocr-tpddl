// Combines two OCR engines word by word. Tesseract's LSTM engine reads letters well
// but often drops decimal points in numbers ("1.5g" → "15g"); the legacy engine keeps
// punctuation but confuses look-alike glyphs ("I.5g", "IZ%"). Numbers are rebuilt
// from both readings; everything else comes from the LSTM engine.
import type { BBox, OcrLine, OcrWord } from '../types'

const UNIT_RE = /^(?:%|mg|mcg|µg|kg|g|kj|kcal|cal|ml|l|oz|lbs?|pcs?)$/i
const CURRENCY_RE = /^[$€£₹¥]/
const CORE_RE = /^[-+(]?\d[\d.,/:-]*\)?$/

// Look-alikes the legacy engine produces inside numbers.
const DIGIT_LOOKALIKES: Record<string, string> = {
  I: '1', l: '1', '|': '1', '!': '1', i: '1',
  O: '0', o: '0', Q: '0', D: '0',
  Z: '2', z: '2',
  S: '5', s: '5',
  B: '8',
  q: '9',
}

export interface NumericToken {
  prefix: string
  core: string
  unit: string
  /** Per character of `core`: true when it was a look-alike letter turned into a digit. */
  guessed?: boolean[]
}

/** Splits "1,234.50kg" into currency prefix, numeric core and unit; null when it isn't a number. */
export function parseNumeric(text: string, fixLookalikes = false): NumericToken | null {
  let rest = text.trim()
  const prefix = CURRENCY_RE.exec(rest)?.[0] ?? ''
  rest = rest.slice(prefix.length)
  // Longest trailing run that is a known unit ("IZ%" → core "IZ", unit "%").
  const trailing = /[a-zA-Z%µ]+$/.exec(rest)?.[0] ?? ''
  let unit = ''
  for (let len = trailing.length; len > 0; len--) {
    const candidate = trailing.slice(-len)
    if (UNIT_RE.test(candidate) && rest.length > len) {
      unit = candidate
      rest = rest.slice(0, -len)
      break
    }
  }
  const chars = [...rest]
  const guessed = chars.map((c) => fixLookalikes && c in DIGIT_LOOKALIKES)
  const core = chars.map((c, i) => (guessed[i] ? DIGIT_LOOKALIKES[c] : c)).join('')
  if (!CORE_RE.test(core)) return null
  // A lone look-alike ("O", "I") is too ambiguous to call a number.
  if (fixLookalikes && !/\d/.test(rest) && core.length < 2) return null
  return guessed.some(Boolean) ? { prefix, core, unit, guessed } : { prefix, core, unit }
}

const digitsOf = (core: string) => core.replace(/\D/g, '')
const separators = (core: string) => core.replace(/\d/g, '').length
const format = (t: NumericToken) => t.prefix + t.core + t.unit

/** "259" → "25g" when the other engine read the same digits followed by "g". */
function restoreTrailingG(token: NumericToken, other: NumericToken): NumericToken {
  if (token.unit || other.unit.toLowerCase() !== 'g' || !token.core.endsWith('9')) return token
  if (digitsOf(token.core).slice(0, -1) !== digitsOf(other.core)) return token
  return { ...token, core: token.core.slice(0, -1), unit: 'g' }
}

/** Picks or rebuilds the best reading of one word from the two engines. */
export function chooseReading(lstm: OcrWord, legacy: OcrWord): string {
  if (lstm.text === legacy.text) return lstm.text
  let a = parseNumeric(lstm.text)
  let b = parseNumeric(legacy.text, true)

  // "15.09" is usually "15.0g": both engines sometimes read a trailing g as 9, and the
  // other engine's reading tells us which it was.
  if (b && a) {
    b = restoreTrailingG(b, a)
    a = restoreTrailingG(a, b)
  }

  if (a && b) {
    const unit = a.unit || b.unit
    const prefix = a.prefix || b.prefix
    // Same digits: keep whichever kept the decimal point / thousands separators.
    if (digitsOf(a.core) === digitsOf(b.core)) {
      return prefix + (separators(b.core) > separators(a.core) ? b.core : a.core) + unit
    }
    // Same shape, different digits: where the legacy engine only guessed a look-alike
    // ("ZZOO" for "2260"), trust the LSTM digit; keep the legacy's genuine digits.
    if (b.guessed && a.core.length === b.core.length) {
      const core = [...b.core].map((c, i) => (b.guessed?.[i] && /\d/.test(a.core[i]) ? a.core[i] : c)).join('')
      return prefix + core + unit
    }
    // Different digits: a reading that kept the unit is more complete.
    if (a.unit && !b.unit) return format(a)
    if (b.unit && !a.unit) return format(b)
    return lstm.confidence >= 70 ? format(a) : format(b)
  }
  // Only the legacy reading is a number: accept it if it contains at least one real digit
  // (so words like "Oil" never turn into "01l").
  if (b && !a && /\d/.test(legacy.text)) return format(b)
  // Words: the LSTM engine is better overall, but when it is unsure and the legacy
  // engine is confident about a clean word ("0il" c52 vs "Oil" c88), take the legacy one.
  // Only for same-length readings differing in a few letters, i.e. glyph substitutions.
  if (
    lstm.confidence < LSTM_UNSURE &&
    legacy.confidence >= LEGACY_SURE &&
    /^[\p{L}\p{N}'’-]+$/u.test(legacy.text) &&
    isSubstitution(lstm.text, legacy.text)
  ) {
    return legacy.text
  }
  return lstm.text
}

function isSubstitution(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) if (a[i].toLowerCase() !== b[i].toLowerCase()) diff++
  return diff <= Math.max(1, Math.floor(a.length / 4))
}

const LSTM_UNSURE = 60
const LEGACY_SURE = 80
/** Confidence given to numbers the two engines read with different digits (flagged for review). */
const DISAGREE_CONFIDENCE = 40

/**
 * - agree: same word, or same digits (differing only in dots/units the other dropped)
 * - conflict: both read a number but with different digits
 * - legacy: the LSTM output was pure noise, so the legacy reading stands alone
 * - unknown: anything else
 */
export function agreement(lstm: OcrWord, legacy: OcrWord): 'agree' | 'conflict' | 'legacy' | 'unknown' {
  if (lstm.text.toLowerCase() === legacy.text.toLowerCase()) return 'agree'
  let a = parseNumeric(lstm.text)
  let b = parseNumeric(legacy.text, true)
  if (a && b) {
    b = restoreTrailingG(b, a)
    a = restoreTrailingG(a, b)
  }
  if (!a && b) {
    // LSTM produced a garbled number with the same digits ("565k)" vs "565kJ").
    const digits = digitsOf(lstm.text)
    if (digits && digits === digitsOf(b.core)) return 'agree'
    // LSTM produced pure noise ("|" for "1"): the legacy reading is all we have.
    if (!/[\p{L}\p{N}]/u.test(lstm.text) && /\d/.test(legacy.text)) return 'legacy'
  }
  if (!a || !b) return 'unknown'
  if (digitsOf(a.core) === digitsOf(b.core)) return 'agree'
  // Compare only digits the legacy engine really read, not look-alike guesses ("ZZOO").
  if (b.guessed && a.core.length === b.core.length) {
    const genuine = [...b.core].map((c, i) => (b.guessed?.[i] ? null : c)).map((c, i) => (c === null ? null : c === a.core[i]))
    if (genuine.includes(false)) return 'conflict'
    return genuine.includes(true) ? 'agree' : 'unknown'
  }
  return 'conflict'
}

const area = (b: BBox) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0)

function intersection(a: BBox, b: BBox): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
  return w > 0 && h > 0 ? w * h : 0
}

/** Intersection over union: high only when two boxes cover (nearly) the same word. */
export function iou(a: BBox, b: BBox): number {
  const i = intersection(a, b)
  return i ? i / (area(a) + area(b) - i) : 0
}

/** Pairs each LSTM word with at most one legacy word (and vice versa), best matches first. */
function matchWords(lstmWords: OcrWord[], legacyWords: OcrWord[]): Map<OcrWord, OcrWord> {
  const pairs: { a: OcrWord; b: OcrWord; score: number }[] = []
  for (const a of lstmWords) {
    for (const b of legacyWords) {
      const score = iou(a.bbox, b.bbox)
      if (score >= 0.3) pairs.push({ a, b, score })
    }
  }
  pairs.sort((x, y) => y.score - x.score)
  const matched = new Map<OcrWord, OcrWord>()
  const taken = new Set<OcrWord>()
  for (const { a, b } of pairs) {
    if (matched.has(a) || taken.has(b)) continue
    matched.set(a, b)
    taken.add(b)
  }
  return matched
}

/**
 * Replaces each LSTM word with the combined reading of its matching legacy word.
 * Legacy-only words that are clean numbers are added (the LSTM pass sometimes misses them).
 */
export function combineEngines(lstmLines: OcrLine[], legacyLines: OcrLine[]): OcrLine[] {
  const lstmWords = lstmLines.flatMap((l) => l.words)
  const matches = matchWords(lstmWords, legacyLines.flatMap((l) => l.words))
  const used = new Set(matches.values())

  const lines = lstmLines.map((line) => ({
    ...line,
    words: line.words.map((word) => {
      const partner = matches.get(word)
      if (!partner) return word
      const text = chooseReading(word, partner)
      // Agreement between two independent engines is strong evidence; disagreement on
      // digits is a warning sign even when one engine claims to be confident.
      const verdict = agreement(word, partner)
      const confidence = {
        agree: Math.max(word.confidence, partner.confidence),
        conflict: Math.min(word.confidence, DISAGREE_CONFIDENCE),
        legacy: partner.confidence,
        unknown: word.confidence,
      }[verdict]
      return { ...word, text, confidence }
    }),
  }))

  const extras = legacyLines
    .map((line) => ({
      ...line,
      words: line.words.filter((w) => {
        if (used.has(w) || lstmWords.some((x) => intersection(x.bbox, w.bbox) > 0)) return false
        const n = parseNumeric(w.text, true)
        return n !== null && /\d/.test(w.text)
      }).map((w) => ({ ...w, text: format(parseNumeric(w.text, true) as NumericToken) })),
    }))
    .filter((l) => l.words.length > 0)

  return [...lines, ...extras]
}

/**
 * Uses a second reading of the same page (e.g. the sparse-layout pass) as another
 * opinion on numbers only: "259" + "25g" → "25g", "15g" + "1.5g" → "1.5g".
 * Words are left alone; the second reading is from the same engine, so it adds
 * little for text.
 */
export function reconcileNumbers(lines: OcrLine[], otherLines: OcrLine[]): OcrLine[] {
  const matches = matchWords(
    lines.flatMap((l) => l.words),
    otherLines.flatMap((l) => l.words),
  )
  return lines.map((line) => ({
    ...line,
    words: line.words.map((word) => {
      const partner = matches.get(word)
      if (!partner || partner.text === word.text) return word
      // Both must be genuine numbers (no look-alike guessing), and only the two safe
      // repairs apply: a restored "g" and a recovered decimal point with identical digits.
      let a = parseNumeric(word.text)
      let b = parseNumeric(partner.text)
      if (!a || !b) return word
      a = restoreTrailingG(a, b)
      b = restoreTrailingG(b, a)
      if (digitsOf(a.core) !== digitsOf(b.core)) return word
      const core = separators(b.core) > separators(a.core) ? b.core : a.core
      const text = (a.prefix || b.prefix) + core + (a.unit || b.unit)
      if (text === word.text) return word
      return { ...word, text, confidence: Math.max(word.confidence, partner.confidence) }
    }),
  }))
}
