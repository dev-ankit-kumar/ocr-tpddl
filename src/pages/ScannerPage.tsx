import { useEffect, useState, type DragEvent } from 'react'
import { Alert } from '../components/Alert'
import { AppHeader } from '../components/AppHeader'
import { Button } from '../components/Button'
import { CameraView } from '../components/CameraView'
import { FilePickerButton } from '../components/FilePickerButton'
import { RetakeIcon, SparkleIcon, SwitchCameraIcon, UploadIcon } from '../components/icons'
import { PrivacyNote } from '../components/PrivacyNote'
import { useCamera } from '../hooks/useCamera'
import { useObjectUrl } from '../hooks/useObjectUrl'
import { warmUpTesseract } from '../workers/tesseractWorker'

const MAX_FILE_BYTES = 30 * 1024 * 1024

interface ScannerPageProps {
  onBack: () => void
  onExtract: (image: Blob, enhance: boolean) => void
}

export function ScannerPage({ onBack, onExtract }: ScannerPageProps) {
  const camera = useCamera()
  const { start, stop } = camera
  const [image, setImage] = useState<Blob | null>(null)
  const [enhance, setEnhance] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const previewUrl = useObjectUrl(image)

  useEffect(() => {
    void start()
    // Load the OCR engine while the user frames the shot.
    warmUpTesseract()
  }, [start])

  const acceptImage = (blob: Blob) => {
    setError(null)
    setImage(blob)
    stop() // No need to keep the camera on once we have a picture.
  }

  const handleFile = (file: File) => {
    if (!file.type.startsWith('image/')) return setError('Please choose an image file (JPG, PNG, WebP…).')
    if (file.size > MAX_FILE_BYTES) return setError('That image is larger than 30 MB. Please choose a smaller one.')
    acceptImage(file)
  }

  const handleCapture = async () => {
    try {
      acceptImage(await camera.capture())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not capture the photo.')
    }
  }

  const handleRetake = () => {
    setImage(null)
    setError(null)
    void start(camera.facingMode)
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  return (
    <div className="flex h-dvh flex-col bg-slate-50">
      <AppHeader title={image ? 'Check your photo' : 'Scan document'} onBack={onBack} />

      <main
        className="mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4"
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <div className={`relative min-h-0 flex-1 overflow-hidden rounded-2xl bg-slate-950 ${dragging ? 'ring-4 ring-brand-500' : ''}`}>
          {image && previewUrl ? (
            <img src={previewUrl} alt="Captured document" className="h-full w-full object-contain" />
          ) : (
            <CameraView
              videoRef={camera.videoRef}
              status={camera.status}
              error={camera.error}
              mirrored={camera.facingMode === 'user'}
              onRetry={() => void start(camera.facingMode)}
              onFile={handleFile}
            />
          )}
          {!image && camera.canSwitch && camera.status === 'active' && (
            <Button
              variant="overlay"
              size="sm"
              icon={<SwitchCameraIcon />}
              onClick={camera.switchCamera}
              className="absolute right-3 bottom-3"
              aria-label="Switch camera"
            >
              Flip
            </Button>
          )}
        </div>

        {error && <Alert tone="error">{error}</Alert>}

        {image ? (
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-3 rounded-xl bg-white px-3.5 py-3 text-sm ring-1 ring-slate-200">
              <input
                type="checkbox"
                checked={enhance}
                onChange={(e) => setEnhance(e.target.checked)}
                className="size-4 accent-brand-700"
              />
              <span>
                <span className="font-medium text-slate-800">Auto-enhance</span>
                <span className="text-slate-500"> – crop to the page, boost contrast and sharpen for better accuracy</span>
              </span>
            </label>
            <div className="grid grid-cols-[auto_1fr] gap-2">
              <Button variant="secondary" size="lg" icon={<RetakeIcon />} onClick={handleRetake}>
                Retake
              </Button>
              <Button size="lg" icon={<SparkleIcon />} onClick={() => onExtract(image, enhance)}>
                Extract Data
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <FilePickerButton onFile={handleFile} icon={<UploadIcon />} className="justify-self-start">
              Upload
            </FilePickerButton>
            <button
              type="button"
              onClick={handleCapture}
              disabled={camera.status !== 'active'}
              aria-label="Capture photo"
              className="flex size-18 items-center justify-center rounded-full bg-white shadow-md ring-4 ring-brand-700 transition active:scale-95 disabled:opacity-40 disabled:ring-slate-300"
            >
              <span className="size-14 rounded-full bg-brand-700" />
            </button>
            <span />
          </div>
        )}

        <PrivacyNote className="justify-center text-center" />
      </main>
    </div>
  )
}
