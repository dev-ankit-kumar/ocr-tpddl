import { useEffect, useState } from 'react'
import { Alert } from '../components/Alert'
import { AppHeader } from '../components/AppHeader'
import { Button } from '../components/Button'
import { PrivacyNote } from '../components/PrivacyNote'
import { Spinner } from '../components/Spinner'
import { ProgressBar } from '../components/ProgressBar'
import { useObjectUrl } from '../hooks/useObjectUrl'
import { useProcessing, type ProcessingTask } from '../hooks/useProcessing'
import type { ProcessingStep } from '../types'

export type ProcessingSteps = { step: ProcessingStep; label: string }[]

interface ProcessingPageProps<T> {
  image: Blob
  title: string
  steps: ProcessingSteps
  /** Must be stable (useCallback): a new task restarts processing. */
  task: ProcessingTask<T>
  onDone: (result: T) => void
  onCancel: () => void
}

export function ProcessingPage<T>({ image, title, steps, task, onDone, onCancel }: ProcessingPageProps<T>) {
  const { run, cancel, progress, error, running } = useProcessing<T>()
  const [attempt, setAttempt] = useState(0)
  const previewUrl = useObjectUrl(image)

  useEffect(() => {
    let active = true
    void run(task).then((result) => {
      if (active && result !== null) onDone(result)
    })
    return () => {
      active = false
    }
  }, [task, run, onDone, attempt])

  const handleCancel = () => {
    cancel()
    onCancel()
  }

  const currentIndex = Math.max(0, steps.findIndex((s) => s.step === progress.step))

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader title={title} onBack={handleCancel} />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 p-5">
        {previewUrl && (
          <div className="relative mx-auto aspect-[3/4] w-40 overflow-hidden rounded-2xl bg-slate-200 shadow-md ring-1 ring-slate-200">
            <img src={previewUrl} alt="" className="h-full w-full object-cover" />
            {running && (
              <div className="absolute inset-x-0 h-1/4 animate-pulse bg-gradient-to-b from-transparent via-brand-500/40 to-transparent" />
            )}
          </div>
        )}

        {error ? (
          <Alert
            tone="error"
            title="Reading failed"
            action={
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setAttempt((a) => a + 1)}>
                  Try again
                </Button>
                <Button size="sm" variant="secondary" onClick={onCancel}>
                  Back to scanner
                </Button>
              </div>
            }
          >
            {error}
          </Alert>
        ) : (
          <>
            <ProgressBar value={progress.progress} label={progress.label} />
            <ol className="space-y-2.5">
              {steps.map((s, i) => {
                const state = i < currentIndex ? 'done' : i === currentIndex ? 'active' : 'todo'
                return (
                  <li key={s.step} className="flex items-center gap-3 text-sm">
                    <span
                      className={`flex size-6 items-center justify-center rounded-full text-xs font-bold ${
                        state === 'done' ? 'bg-brand-600 text-white' : state === 'active' ? 'bg-brand-100 text-brand-800' : 'bg-slate-200 text-slate-500'
                      }`}
                    >
                      {state === 'done' ? '✓' : state === 'active' ? <Spinner className="size-3.5" /> : i + 1}
                    </span>
                    <span className={state === 'todo' ? 'text-slate-400' : 'font-medium text-slate-800'}>{s.label}</span>
                  </li>
                )
              })}
            </ol>
            <p className="text-xs text-slate-500">
              The first scan downloads the OCR engine (about 20–30 MB) once; later scans start much faster and work offline.
            </p>
            <Button variant="secondary" onClick={handleCancel}>
              Cancel
            </Button>
          </>
        )}
        <PrivacyNote className="justify-center text-center" />
      </main>
    </div>
  )
}
