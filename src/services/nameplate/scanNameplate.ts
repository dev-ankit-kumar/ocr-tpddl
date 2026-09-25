import type { ProcessingProgress } from '../../types'
import { readImage, readRegions, type PaddleProgress } from '../paddle/paddleClient'
import { extractNameplate, planRereads, type NameplateField, type NameplateReadings, type OcrPhrase } from './extractNameplate'

/** Detection settings tuned on real nameplate photos (faded, stained, glary metal). */
const READ_OPTIONS = { normalize: true, detThreshold: 0.1, boxMinScore: 0.3 }

export interface NameplateScan {
  readings: NameplateReadings
  /** All text found on the plate (for reference and troubleshooting). */
  lines: OcrPhrase[]
}

function progressFor(p: PaddleProgress): ProcessingProgress {
  if (p.stage === 'loading') return { step: 'load-engine', progress: 0.05 + 0.25 * p.value, label: 'Loading OCR engine…' }
  if (p.stage === 'detecting') return { step: 'recognize', progress: 0.32, label: 'Finding text on the plate…' }
  return { step: 'recognize', progress: 0.35 + 0.45 * p.value, label: 'Reading the plate…' }
}

/**
 * Reads a transformer nameplate on the device: one OCR pass over the whole plate,
 * then zoomed re-reads of the value boxes next to any label whose value was missing
 * or uncertain (faint stamped digits are often only readable up close).
 */
export async function scanNameplate(image: Blob, onProgress: (p: ProcessingProgress) => void): Promise<NameplateScan> {
  onProgress({ step: 'load-engine', progress: 0.05, label: 'Loading OCR engine…' })
  const lines = await readImage(image, READ_OPTIONS, (p) => onProgress(progressFor(p)))

  const plan = planRereads(lines)
  const rereads: Partial<Record<NameplateField, OcrPhrase[]>> = {}
  if (plan.length) {
    onProgress({ step: 'recognize', progress: 0.85, label: 'Double-checking values…' })
    const results = await readRegions(
      image,
      plan.map((p) => p.region),
      READ_OPTIONS,
    )
    plan.forEach((p, i) => {
      rereads[p.field] = results[i] ?? []
    })
  }

  onProgress({ step: 'parse', progress: 0.97, label: 'Filling in the fields…' })
  const readings = extractNameplate(lines, rereads)
  onProgress({ step: 'parse', progress: 1, label: 'Done' })
  return { readings, lines }
}
