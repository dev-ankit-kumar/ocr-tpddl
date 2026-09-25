import { useCallback, useEffect, useRef, useState } from 'react'
import type { CameraError } from '../types'

export type CameraStatus = 'idle' | 'starting' | 'active' | 'error'
export type FacingMode = 'environment' | 'user'

function toCameraError(err: unknown): CameraError {
  const name = err instanceof DOMException || err instanceof Error ? err.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return {
        kind: 'permission-denied',
        message: 'Camera access was blocked. Allow camera permission in your browser settings, or upload a photo instead.',
      }
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return { kind: 'not-found', message: 'No camera was found on this device. You can upload a photo instead.' }
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return { kind: 'in-use', message: 'The camera is being used by another app. Close it and try again.' }
    default:
      return { kind: 'unknown', message: 'Could not start the camera. You can upload a photo instead.' }
  }
}

function unsupportedError(): CameraError | null {
  if (!window.isSecureContext) {
    return { kind: 'insecure', message: 'Camera access needs a secure (HTTPS) connection. Upload a photo instead, or open the app over HTTPS.' }
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return { kind: 'unsupported', message: "This browser doesn't support camera access. Upload a photo instead." }
  }
  return null
}

// ImageCapture (Chrome/Android) isn't in TypeScript's DOM lib yet.
interface ImageCaptureLike {
  takePhoto(): Promise<Blob>
}
declare const ImageCapture: { new (track: MediaStreamTrack): ImageCaptureLike } | undefined

/** Full-resolution still from the camera; null when unsupported or it fails. */
async function takeStillPhoto(stream: MediaStream | null): Promise<Blob | null> {
  const track = stream?.getVideoTracks()[0]
  if (!track || typeof ImageCapture === 'undefined') return null
  try {
    const photo = await new ImageCapture(track).takePhoto()
    return photo.size > 0 ? photo : null
  } catch (err) {
    console.warn('Still photo capture failed, using a video frame instead:', err)
    return null
  }
}

/** Keeps text sharp while the phone moves (Android); silently ignored elsewhere. */
async function enableContinuousFocus(stream: MediaStream): Promise<void> {
  const track = stream.getVideoTracks()[0]
  const modes = (track?.getCapabilities?.() as { focusMode?: string[] } | undefined)?.focusMode
  if (!track || !modes?.includes('continuous')) return
  try {
    await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] })
  } catch {
    // Not all cameras accept it; the default focus still works.
  }
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop())
}

// Re-opening a camera right after releasing it (e.g. Retake) can fail transiently on some devices.
const TRANSIENT_ERRORS = new Set(['NotReadableError', 'TrackStartError', 'AbortError', 'NotFoundError'])
const RETRIES = 2
const RETRY_DELAY_MS = 400

async function openCamera(constraints: MediaStreamConstraints, isStale: () => boolean): Promise<MediaStream> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints)
    } catch (err) {
      const transient = err instanceof Error && TRANSIENT_ERRORS.has(err.name)
      if (!transient || attempt >= RETRIES || isStale()) throw err
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
    }
  }
}

/** Live camera preview with capture. Tracks are always stopped on unmount. */
export function useCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Callback ref: re-attaches the live stream whenever the <video> element (re)mounts.
  const attachVideo = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el
    if (el && streamRef.current && el.srcObject !== streamRef.current) {
      el.srcObject = streamRef.current
      void el.play().catch(() => {})
    }
  }, [])
  // Incremented on every start/stop so stale getUserMedia results are discarded.
  const requestRef = useRef(0)
  const [status, setStatus] = useState<CameraStatus>('idle')
  const [error, setError] = useState<CameraError | null>(null)
  const [facingMode, setFacingMode] = useState<FacingMode>('environment')
  const [canSwitch, setCanSwitch] = useState(false)

  const stop = useCallback(() => {
    requestRef.current++
    stopStream(streamRef.current)
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setStatus('idle')
  }, [])

  const start = useCallback(async (facing: FacingMode = 'environment') => {
    const unsupported = unsupportedError()
    if (unsupported) {
      setError(unsupported)
      setStatus('error')
      return
    }
    const request = ++requestRef.current
    stopStream(streamRef.current)
    streamRef.current = null
    setError(null)
    setStatus('starting')
    setFacingMode(facing)

    try {
      const stream = await openCamera(
        // Ask for up to 4K: small print needs every pixel. Browsers fall back to the best they have.
        { audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 3840 }, height: { ideal: 2160 } } },
        () => request !== requestRef.current,
      )
      if (request !== requestRef.current) {
        stopStream(stream) // A newer start/stop happened while we were waiting.
        return
      }
      streamRef.current = stream
      void enableContinuousFocus(stream)
      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        await video.play().catch(() => {
          // Autoplay may be deferred; the muted/playsInline video still renders.
        })
      }
      setStatus('active')
      const devices = await navigator.mediaDevices.enumerateDevices()
      setCanSwitch(devices.filter((d) => d.kind === 'videoinput').length > 1)
    } catch (err) {
      if (request !== requestRef.current) return
      console.warn('Camera start failed:', err)
      setError(toCameraError(err))
      setStatus('error')
    }
  }, [])

  const switchCamera = useCallback(() => {
    void start(facingMode === 'environment' ? 'user' : 'environment')
  }, [facingMode, start])

  /**
   * Takes a real still photo where supported (full sensor resolution, focused),
   * otherwise grabs the current video frame.
   */
  const capture = useCallback(async (): Promise<Blob> => {
    const video = videoRef.current
    if (!video || !video.videoWidth) throw new Error('The camera is not ready yet.')
    const still = await takeStillPhoto(streamRef.current)
    if (still) return still
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not capture the photo.')
    ctx.drawImage(video, 0, 0)
    return new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not capture the photo.'))), 'image/jpeg', 0.95),
    )
  }, [])

  // Never leave the camera running after the component goes away.
  useEffect(() => () => {
    requestRef.current++
    stopStream(streamRef.current)
    streamRef.current = null
  }, [])

  return { videoRef: attachVideo, status, error, facingMode, canSwitch, start, stop, switchCamera, capture }
}
