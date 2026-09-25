import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRegister } from './hooks/useRegister'
import type { ProcessingTask } from './hooks/useProcessing'
import { HomePage } from './pages/HomePage'
import { NameplateReviewPage } from './pages/NameplateReviewPage'
import { ProcessingPage, type ProcessingSteps } from './pages/ProcessingPage'
import { RegisterPage } from './pages/RegisterPage'
import { ResultsPage } from './pages/ResultsPage'
import { ScannerPage } from './pages/ScannerPage'
import { extractDocument } from './services/extractionPipeline'
import { scanNameplate, type NameplateScan } from './services/nameplate/scanNameplate'
import type { ExtractionResult, ScanMode, Stage } from './types'

interface Capture {
  image: Blob
  autoCrop: boolean
}

const TABLE_STEPS: ProcessingSteps = [
  { step: 'preprocess', label: 'Prepare image' },
  { step: 'load-engine', label: 'Load OCR engine' },
  { step: 'recognize', label: 'Read text' },
  { step: 'parse', label: 'Build table' },
]

const NAMEPLATE_STEPS: ProcessingSteps = [
  { step: 'load-engine', label: 'Load OCR engine' },
  { step: 'recognize', label: 'Read the nameplate' },
  { step: 'parse', label: 'Fill in Make, Sr. No, KVA, Year' },
]

export default function App() {
  const [stage, setStage] = useState<Stage>('home')
  const [mode, setMode] = useState<ScanMode>('nameplate')
  const [capture, setCapture] = useState<Capture | null>(null)
  const [result, setResult] = useState<ExtractionResult | null>(null)
  const [nameplate, setNameplate] = useState<NameplateScan | null>(null)
  // Bumped per scan so the review/results screens start fresh each time.
  const [resultKey, setResultKey] = useState(0)
  const register = useRegister()
  const dataRef = useRef({ result, nameplate })
  useEffect(() => {
    dataRef.current = { result, nameplate }
  }, [result, nameplate])

  // Mirror stages into browser history so the phone's Back button behaves naturally.
  const navigate = useCallback((next: Stage, replace = false) => {
    if (replace) window.history.replaceState({ stage: next }, '')
    else window.history.pushState({ stage: next }, '')
    setStage(next)
    window.scrollTo(0, 0)
  }, [])

  useEffect(() => {
    window.history.replaceState({ stage: 'home' }, '')
    const onPopState = (e: PopStateEvent) => {
      let next: Stage = (e.state as { stage?: Stage } | null)?.stage ?? 'home'
      // Never re-enter processing via history, and don't show screens whose data is gone.
      if (next === 'processing') next = 'scan'
      if (next === 'results' && !dataRef.current.result) next = 'scan'
      if (next === 'review' && !dataRef.current.nameplate) next = 'scan'
      setStage(next)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const startScan = useCallback(
    (next: ScanMode) => {
      setMode(next)
      navigate('scan')
    },
    [navigate],
  )

  const handleExtract = useCallback(
    (image: Blob, autoCrop: boolean) => {
      setCapture({ image, autoCrop })
      navigate('processing')
    },
    [navigate],
  )

  const tableTask = useCallback<ProcessingTask<ExtractionResult>>(
    (onProgress, signal) => extractDocument(capture!.image, { autoCrop: capture!.autoCrop, onProgress, signal }),
    [capture],
  )
  const nameplateTask = useCallback<ProcessingTask<NameplateScan>>((onProgress) => scanNameplate(capture!.image, onProgress), [capture])

  // Replace the processing entry so Back from the next screen returns to the scanner.
  const handleTableDone = useCallback(
    (next: ExtractionResult) => {
      setResult(next)
      setResultKey((k) => k + 1)
      navigate('results', true)
    },
    [navigate],
  )
  const handleNameplateDone = useCallback(
    (next: NameplateScan) => {
      setNameplate(next)
      setResultKey((k) => k + 1)
      navigate('review', true)
    },
    [navigate],
  )

  const knownMakes = useMemo(() => [...new Set(register.records.map((r) => r.make).filter(Boolean))], [register.records])

  const goBack = useCallback(() => window.history.back(), [])
  const scanAgain = useCallback(() => navigate('scan'), [navigate])
  const scanner = <ScannerPage mode={mode} onBack={goBack} onExtract={handleExtract} />
  const home = <HomePage savedCount={register.records.length} onStart={startScan} onOpenRegister={() => navigate('register')} />

  switch (stage) {
    case 'home':
      return home
    case 'scan':
      return scanner
    case 'processing':
      if (!capture) return scanner
      return mode === 'nameplate' ? (
        <ProcessingPage image={capture.image} title="Reading nameplate" steps={NAMEPLATE_STEPS} task={nameplateTask} onDone={handleNameplateDone} onCancel={goBack} />
      ) : (
        <ProcessingPage image={capture.image} title="Extracting data" steps={TABLE_STEPS} task={tableTask} onDone={handleTableDone} onCancel={goBack} />
      )
    case 'results':
      return result ? <ResultsPage key={resultKey} result={result} image={capture?.image ?? null} onScanAgain={scanAgain} /> : home
    case 'review':
      return nameplate && capture ? (
        <NameplateReviewPage
          key={resultKey}
          image={capture.image}
          scan={nameplate}
          knownMakes={knownMakes}
          savedCount={register.records.length}
          onRetake={goBack}
          onSave={(record, then) => {
            register.add(record)
            setNameplate(null)
            navigate(then === 'scan' ? 'scan' : 'register', true)
          }}
        />
      ) : (
        scanner
      )
    case 'register':
      return <RegisterPage onBack={goBack} onScan={() => startScan('nameplate')} />
  }
}
