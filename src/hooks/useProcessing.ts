import { useCallback, useEffect, useRef, useState } from 'react'
import { terminatePaddle } from '../services/paddle/paddleClient'
import type { ProcessingProgress } from '../types'
import { terminateTesseract } from '../workers/tesseractWorker'

const INITIAL: ProcessingProgress = { step: 'preprocess', progress: 0, label: 'Starting…' }

export type ProcessingTask<T> = (onProgress: (p: ProcessingProgress) => void, signal: AbortSignal) => Promise<T>

function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (/network|fetch|load/i.test(message)) {
    return 'The OCR engine could not be loaded. Check your connection for the first run and try again.'
  }
  if (/memory|allocation/i.test(message)) {
    return 'Your device ran out of memory while reading this image. Try a smaller or tighter crop.'
  }
  return message || 'Something went wrong while reading the image.'
}

/** Runs one OCR task and exposes progress, error and cancel. */
export function useProcessing<T>() {
  const [progress, setProgress] = useState<ProcessingProgress>(INITIAL)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)

  const run = useCallback(async (task: ProcessingTask<T>): Promise<T | null> => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setError(null)
    setProgress(INITIAL)
    setRunning(true)
    try {
      // Only ever move forward so late events from a previous step can't rewind the bar.
      return await task((p) => setProgress((prev) => (p.progress >= prev.progress ? p : { ...p, progress: prev.progress })), controller.signal)
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
    // OCR jobs can't be aborted individually; stop the engines instead.
    void terminateTesseract()
    terminatePaddle()
  }, [])

  // Leaving mid-run (e.g. browser Back) shouldn't keep OCR burning CPU in the background.
  useEffect(() => cancel, [cancel])

  return { run, cancel, progress, error, running }
}
