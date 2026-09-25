import type { Progress } from '../../types'
import { readImage, readRegions, type PaddleProgress } from '../paddle/paddleClient'
import { extractNameplate, planRereads, type NameplateData, type OcrPhrase } from './extractNameplate'

/** Detection settings tuned on real nameplate photos (faded, stained, glary metal). */
const READ_OPTIONS = { normalize: true, detThreshold: 0.1, boxMinScore: 0.3 }

function progressFor(p: PaddleProgress): Progress {
  if (p.stage === 'loading') return { value: 0.05 + 0.25 * p.value, label: 'Loading OCR engine…' }
  if (p.stage === 'detecting') return { value: 0.32, label: 'Finding text on the nameplate…' }
  return { value: 0.35 + 0.45 * p.value, label: 'Reading the nameplate…' }
}

/**
 * Reads KVA, Year of MFG, Manufacturer and Sr. No. from a nameplate photo, on the
 * device: one OCR pass over the plate, then zoomed re-reads of the value boxes next
 * to any label whose value wasn't confidently read (faint stamped digits are often
 * only readable up close).
 */
export async function scanNameplate(image: Blob, onProgress: (p: Progress) => void): Promise<NameplateData> {
  onProgress({ value: 0.05, label: 'Loading OCR engine…' })
  const phrases = await readImage(image, READ_OPTIONS, (p) => onProgress(progressFor(p)))

  const plan = planRereads(phrases)
  const rereads: Partial<Record<(typeof plan)[number]['field'], OcrPhrase[]>> = {}
  if (plan.length) {
    onProgress({ value: 0.85, label: 'Double-checking values…' })
    const results = await readRegions(
      image,
      plan.map((p) => p.region),
      READ_OPTIONS,
    )
    plan.forEach((p, i) => {
      rereads[p.field] = results[i] ?? []
    })
  }

  onProgress({ value: 1, label: 'Done' })
  return extractNameplate(phrases, rereads)
}
