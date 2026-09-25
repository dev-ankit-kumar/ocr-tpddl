import { useCallback, useEffect, useRef, useState } from 'react'
import { HomePage } from './pages/HomePage'
import { ProcessingPage } from './pages/ProcessingPage'
import { ResultsPage } from './pages/ResultsPage'
import { ScannerPage } from './pages/ScannerPage'
import type { ExtractionResult, Stage } from './types'

interface Capture {
  image: Blob
  enhance: boolean
}

export default function App() {
  const [stage, setStage] = useState<Stage>('home')
  const [capture, setCapture] = useState<Capture | null>(null)
  const [result, setResult] = useState<ExtractionResult | null>(null)
  // Bumped per extraction so the results editor starts fresh for each scan.
  const [resultKey, setResultKey] = useState(0)
  const resultRef = useRef(result)
  useEffect(() => {
    resultRef.current = result
  }, [result])

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
      // Never re-enter processing via history, and don't show results that no longer exist.
      if (next === 'processing') next = 'scan'
      if (next === 'results' && !resultRef.current) next = 'scan'
      setStage(next)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const handleExtract = useCallback(
    (image: Blob, enhance: boolean) => {
      setCapture({ image, enhance })
      navigate('processing')
    },
    [navigate],
  )

  const handleDone = useCallback(
    (next: ExtractionResult) => {
      setResult(next)
      setResultKey((k) => k + 1)
      // Replace the processing entry so Back from results returns to the scanner.
      navigate('results', true)
    },
    [navigate],
  )

  const goBack = useCallback(() => window.history.back(), [])
  const scanAgain = useCallback(() => navigate('scan'), [navigate])

  switch (stage) {
    case 'home':
      return <HomePage onStart={() => navigate('scan')} />
    case 'scan':
      return <ScannerPage onBack={goBack} onExtract={handleExtract} />
    case 'processing':
      return capture ? (
        <ProcessingPage image={capture.image} enhance={capture.enhance} onDone={handleDone} onCancel={goBack} />
      ) : (
        <ScannerPage onBack={goBack} onExtract={handleExtract} />
      )
    case 'results':
      return result ? (
        <ResultsPage key={resultKey} result={result} image={capture?.image ?? null} onScanAgain={scanAgain} />
      ) : (
        <HomePage onStart={() => navigate('scan')} />
      )
  }
}
