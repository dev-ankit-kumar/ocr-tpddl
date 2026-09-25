import { useEffect, useRef, useState } from 'react'
import { Alert } from './components/Alert'
import { Button } from './components/Button'
import { CameraCapture } from './components/CameraCapture'
import { FilePickerButton } from './components/FilePickerButton'
import { CameraIcon, CropIcon, DownloadIcon, RetakeIcon, SparkleIcon, UploadIcon } from './components/icons'
import { ImageCropper } from './components/ImageCropper'
import { Logo } from './components/Logo'
import { PrivacyNote } from './components/PrivacyNote'
import { ProgressBar } from './components/ProgressBar'
import { Spinner } from './components/Spinner'
import { useObjectUrl } from './hooks/useObjectUrl'
import { downloadExcel, NOT_DETECTED } from './services/nameplate/excelExport'
import { FIELDS, type NameplateData } from './services/nameplate/extractNameplate'
import { scanNameplate } from './services/nameplate/scanNameplate'
import { initPaddle } from './services/paddle/paddleClient'
import type { Progress } from './types'

const MAX_FILE_BYTES = 30 * 1024 * 1024

export default function App() {
  const [image, setImage] = useState<Blob | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cropping, setCropping] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [data, setData] = useState<NameplateData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const previewUrl = useObjectUrl(image)
  // Ignore results of a scan that was superseded by a new image.
  const runRef = useRef(0)

  // Start loading the OCR engine right away so "Extract Details" is quicker.
  useEffect(() => {
    initPaddle().catch(() => {})
  }, [])

  const acceptImage = (blob: Blob) => {
    runRef.current++
    setImage(blob)
    setCameraOpen(false)
    setData(null)
    setError(null)
    setProgress(null)
  }

  const handleFile = (file: File) => {
    if (!file.type.startsWith('image/')) return setError('Please choose an image file (JPG, PNG, …).')
    if (file.size > MAX_FILE_BYTES) return setError('That image is larger than 30 MB. Please choose a smaller one.')
    acceptImage(file)
  }

  const reset = () => {
    runRef.current++
    setImage(null)
    setData(null)
    setError(null)
    setProgress(null)
  }

  const extract = async () => {
    if (!image) return
    const run = ++runRef.current
    setData(null)
    setError(null)
    setProgress({ value: 0, label: 'Starting…' })
    try {
      const result = await scanNameplate(image, (p) => run === runRef.current && setProgress(p))
      if (run === runRef.current) setData(result)
    } catch (err) {
      console.error(err)
      if (run === runRef.current) {
        setError(/fetch|network|load/i.test(String(err)) ? 'The OCR engine could not be loaded. Check your internet connection for the first use and try again.' : 'Something went wrong while reading the image. Please try again.')
      }
    } finally {
      if (run === runRef.current) setProgress(null)
    }
  }

  const handleDownload = async () => {
    if (!data) return
    setDownloading(true)
    try {
      await downloadExcel(data)
    } catch (err) {
      console.error(err)
      setError('The Excel file could not be created. Please try again.')
    } finally {
      setDownloading(false)
    }
  }

  const reading = progress !== null
  const missing = data ? FIELDS.filter((f) => data[f.key] === null).length : 0

  return (
    <main className="mx-auto flex min-h-full max-w-lg flex-col gap-4 px-4 py-6 safe-bottom">
      <header>
        <Logo />
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">Transformer nameplate → Excel</h1>
        <p className="mt-1 text-sm text-slate-600">Reads KVA, Year of MFG, Manufacturer and Sr. No. from a nameplate photo.</p>
      </header>

      {/* 1. Upload image / open camera */}
      {cameraOpen ? (
        <CameraCapture onCapture={acceptImage} onFile={handleFile} onClose={() => setCameraOpen(false)} />
      ) : (
        !image && (
          <div className="grid grid-cols-2 gap-3">
            <FilePickerButton onFile={handleFile} icon={<UploadIcon />} variant="primary" fullWidth>
              Upload Image
            </FilePickerButton>
            <Button variant="secondary" icon={<CameraIcon />} onClick={() => setCameraOpen(true)} fullWidth>
              Open Camera
            </Button>
          </div>
        )
      )}

      {/* 2. Preview */}
      {image && previewUrl && (
        <div className="flex flex-col gap-3">
          <img src={previewUrl} alt="Nameplate" className="max-h-[50vh] w-full rounded-2xl bg-slate-900 object-contain ring-1 ring-slate-200" />
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" icon={<CropIcon />} onClick={() => setCropping(true)} disabled={reading}>
              Crop
            </Button>
            <Button variant="secondary" icon={<RetakeIcon />} onClick={reset} disabled={reading}>
              Change image
            </Button>
          </div>
          {/* 3. Extract */}
          <Button size="lg" icon={reading ? <Spinner className="size-5" /> : <SparkleIcon />} onClick={() => void extract()} disabled={reading}>
            Extract Details
          </Button>
        </div>
      )}

      {progress && <ProgressBar value={progress.value} label={progress.label} />}
      {error && <Alert tone="error">{error}</Alert>}

      {/* 4. Results + 5. Download */}
      {data && (
        <section className="flex flex-col gap-3" aria-label="Extracted details">
          <dl className="divide-y divide-slate-100 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            {FIELDS.map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between gap-4 px-4 py-3">
                <dt className="text-sm font-medium text-slate-600">{label}:</dt>
                <dd data-field={key} className={data[key] === null ? 'text-sm font-medium text-amber-700' : 'text-lg font-bold text-slate-900'}>
                  {data[key] ?? NOT_DETECTED}
                </dd>
              </div>
            ))}
          </dl>
          {missing > 0 && (
            <Alert tone="warning">
              {missing === 1 ? 'One field' : `${missing} fields`} could not be read confidently. Try another photo: closer to the
              nameplate, sharp, and without glare. Cropping to the plate also helps.
            </Alert>
          )}
          <div className="flex flex-col gap-2">
            <Button size="lg" icon={downloading ? <Spinner className="size-5" /> : <DownloadIcon />} onClick={() => void handleDownload()} disabled={downloading}>
              Download Excel
            </Button>
            <Button variant="secondary" size="lg" icon={<RetakeIcon />} onClick={reset}>
              Try another image
            </Button>
          </div>
        </section>
      )}

      <PrivacyNote className="mt-auto pt-4" />

      {cropping && image && (
        <ImageCropper
          image={image}
          onCancel={() => setCropping(false)}
          onApply={(cropped) => {
            setCropping(false)
            acceptImage(cropped)
          }}
        />
      )}
    </main>
  )
}
