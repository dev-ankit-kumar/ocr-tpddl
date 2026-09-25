import type { Ref } from 'react'
import type { CameraStatus } from '../hooks/useCamera'
import type { CameraError } from '../types'
import { Button } from './Button'
import { FilePickerButton } from './FilePickerButton'
import { AlertIcon, RetakeIcon, UploadIcon } from './icons'
import { Spinner } from './Spinner'

interface CameraViewProps {
  videoRef: Ref<HTMLVideoElement>
  status: CameraStatus
  error: CameraError | null
  mirrored: boolean
  onRetry: () => void
  onFile: (file: File) => void
}

/** Live camera preview with a framing guide, loading and error states. */
export function CameraView({ videoRef, status, error, mirrored, onRetry, onFile }: CameraViewProps) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-950">
      {/* Always mounted so the stream can attach as soon as it's ready. */}
      <video
        ref={videoRef}
        className={`h-full w-full object-cover transition-opacity duration-300 ${status === 'active' ? 'opacity-100' : 'opacity-0'} ${mirrored ? '-scale-x-100' : ''}`}
        autoPlay
        muted
        playsInline
        aria-label="Camera preview"
      />

      {status === 'active' && <FrameGuide />}

      {(status === 'starting' || status === 'idle') && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-slate-300">
          <Spinner className="size-8 text-white" />
          Starting camera…
        </div>
      )}

      {status === 'error' && error && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-center shadow-xl">
            <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-amber-100 text-xl text-amber-700">
              <AlertIcon />
            </span>
            <p className="mt-3 font-semibold text-slate-900">Camera unavailable</p>
            <p className="mt-1 text-sm text-slate-600">{error.message}</p>
            <div className="mt-4 flex flex-col gap-2">
              <FilePickerButton onFile={onFile} icon={<UploadIcon />} variant="primary" fullWidth>
                Upload a photo
              </FilePickerButton>
              {error.kind !== 'unsupported' && error.kind !== 'insecure' && (
                <Button variant="ghost" icon={<RetakeIcon />} onClick={onRetry} fullWidth>
                  Try camera again
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FrameGuide() {
  const corner = 'absolute size-8 border-white/90'
  return (
    <div className="pointer-events-none absolute inset-6 sm:inset-10" aria-hidden="true">
      <span className={`${corner} left-0 top-0 rounded-tl-xl border-l-4 border-t-4`} />
      <span className={`${corner} right-0 top-0 rounded-tr-xl border-r-4 border-t-4`} />
      <span className={`${corner} bottom-0 left-0 rounded-bl-xl border-b-4 border-l-4`} />
      <span className={`${corner} bottom-0 right-0 rounded-br-xl border-b-4 border-r-4`} />
      <p className="absolute inset-x-0 top-3 text-center text-xs font-medium text-white/90 drop-shadow">
        Fit the document inside the frame
      </p>
    </div>
  )
}
