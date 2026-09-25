import { useEffect, useState } from 'react'
import { useCamera } from '../hooks/useCamera'
import { Alert } from './Alert'
import { Button } from './Button'
import { CameraView } from './CameraView'
import { CloseIcon, SwitchCameraIcon } from './icons'

interface CameraCaptureProps {
  onCapture: (photo: Blob) => void
  onFile: (file: File) => void
  onClose: () => void
}

/** Live camera with a capture button. The camera is stopped as soon as this closes. */
export function CameraCapture({ onCapture, onFile, onClose }: CameraCaptureProps) {
  const camera = useCamera()
  const { start } = camera
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void start()
  }, [start])

  const capture = async () => {
    try {
      const photo = await camera.capture()
      camera.stop()
      onCapture(photo)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not capture the photo.')
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-slate-950 sm:aspect-video">
        <CameraView
          videoRef={camera.videoRef}
          status={camera.status}
          error={camera.error}
          mirrored={camera.facingMode === 'user'}
          onRetry={() => void start(camera.facingMode)}
          onFile={onFile}
        />
        {camera.canSwitch && camera.status === 'active' && (
          <Button variant="overlay" size="sm" icon={<SwitchCameraIcon />} onClick={camera.switchCamera} className="absolute right-3 bottom-3" aria-label="Switch camera">
            Flip
          </Button>
        )}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid grid-cols-[auto_1fr] gap-2">
        <Button variant="secondary" size="lg" icon={<CloseIcon />} onClick={onClose}>
          Close
        </Button>
        <Button size="lg" onClick={() => void capture()} disabled={camera.status !== 'active'}>
          Capture
        </Button>
      </div>
    </div>
  )
}
