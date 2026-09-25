import { useCallback, useEffect, useRef, useState } from 'react'
import { extractDocument } from '../services/extractionPipeline'
import { terminateTesseract } from '../workers/tesseractWorker'
import type { ExtractionResult, ProcessingProgress } from '../types'

const INITIAL: ProcessingProgress = { step: 'preprocess', progress: 0, label: 'Starting…' }

function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (/network|fetch|load/i.test(message)) {
    return 'The OCR engine could not be loaded. Check your connection for the first run and try again.'
  }
  if (/memory|allocation/i.test(message)) {
    return 'Your device ran out of memory while reading this image. Try a smaller or tighter crop.'
  }
  return message || 'Something went wrong while reading the document.'
}

/** Runs the OCR pipeline for one image and exposes progress, result and cancel. */
export function useExtraction() {
  const [progress, setProgress] = useState<ProcessingProgress>(INITIAL)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)

  const run = useCallback(async (image: Blob, autoCrop: boolean): Promise<ExtractionResult | null> => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setError(null)
    setProgress(INITIAL)
    setRunning(true)
    try {
      return await extractDocument(image, {
        autoCrop,
        signal: controller.signal,
        // Only ever move forward so late events from a previous step can't rewind the bar.
        onProgress: (p) => setProgress((prev) => (p.progress >= prev.progress ? p : { ...p, progress: prev.progress })),
      })
    } catch (err) {
      if (!controller.signal.aborted) setError(friendlyError(err))
      return null
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
        setRunning(false)
      }
    }
  }, [])

  const cancel = useCallback(() => {
    if (!controllerRef.current) return
    controllerRef.current.abort()
    controllerRef.current = null
    setRunning(false)
    // Tesseract jobs can't be aborted individually; restart the engine instead.
    void terminateTesseract()
  }, [])

  // Leaving mid-run (e.g. browser Back) shouldn't keep OCR burning CPU in the background.
  useEffect(() => cancel, [cancel])

  return { run, cancel, progress, error, running }
}
