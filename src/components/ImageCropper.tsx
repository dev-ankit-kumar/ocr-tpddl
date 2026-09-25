import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useObjectUrl } from '../hooks/useObjectUrl'
import { Button } from './Button'
import { RetakeIcon } from './icons'
import { Spinner } from './Spinner'

/** Crop rectangle as fractions (0–1) of the displayed image. */
interface Rect {
  x: number
  y: number
  w: number
  h: number
}

type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se'

const MIN = 0.05
const INITIAL: Rect = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 }
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Applies a drag of (dx, dy) — in image fractions — to the rectangle. */
function dragRect(start: Rect, handle: Handle, dx: number, dy: number): Rect {
  if (handle === 'move') {
    return { ...start, x: clamp(start.x + dx, 0, 1 - start.w), y: clamp(start.y + dy, 0, 1 - start.h) }
  }
  let { x, y } = start
  let right = start.x + start.w
  let bottom = start.y + start.h
  if (handle === 'nw' || handle === 'sw') x = clamp(start.x + dx, 0, right - MIN)
  if (handle === 'ne' || handle === 'se') right = clamp(right + dx, x + MIN, 1)
  if (handle === 'nw' || handle === 'ne') y = clamp(start.y + dy, 0, bottom - MIN)
  if (handle === 'sw' || handle === 'se') bottom = clamp(bottom + dy, y + MIN, 1)
  return { x, y, w: right - x, h: bottom - y }
}

async function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not crop the image.'))), 'image/jpeg', 0.95))
}

/** Cuts `rect` out of the image at full resolution. */
async function cropImage(image: Blob, rect: Rect): Promise<Blob> {
  const bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' })
  const sx = Math.round(rect.x * bitmap.width)
  const sy = Math.round(rect.y * bitmap.height)
  const sw = Math.max(1, Math.round(rect.w * bitmap.width))
  const sh = Math.max(1, Math.round(rect.h * bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  canvas.getContext('2d')!.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh)
  bitmap.close()
  return toBlob(canvas)
}

/** Rotates the image 90° clockwise at full resolution. */
async function rotateImage(image: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' })
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.height
  canvas.height = bitmap.width
  const ctx = canvas.getContext('2d')!
  ctx.translate(canvas.width, 0)
  ctx.rotate(Math.PI / 2)
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  return toBlob(canvas)
}

interface ImageCropperProps {
  image: Blob
  onApply: (image: Blob) => void
  onCancel: () => void
}

/** Full-screen crop editor: drag the corners (or the whole frame), rotate, apply. */
export function ImageCropper({ image, onApply, onCancel }: ImageCropperProps) {
  const [working, setWorking] = useState(image)
  const url = useObjectUrl(working)
  const [rect, setRect] = useState<Rect>(INITIAL)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ handle: Handle; x: number; y: number; start: Rect } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const begin = (handle: Handle) => (e: ReactPointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    frameRef.current?.setPointerCapture(e.pointerId)
    drag.current = { handle, x: e.clientX, y: e.clientY, start: rect }
  }

  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current
    const box = frameRef.current?.getBoundingClientRect()
    if (!d || !box) return
    setRect(dragRect(d.start, d.handle, (e.clientX - d.x) / box.width, (e.clientY - d.y) / box.height))
  }

  const end = () => {
    drag.current = null
  }

  const run = async (job: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await job()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const rotate = () =>
    run(async () => {
      setWorking(await rotateImage(working))
      setRect(INITIAL)
    })

  const apply = () => run(async () => onApply(await cropImage(working, rect)))

  const corner = 'absolute size-7 -m-3.5 rounded-full border-[3px] border-white bg-brand-600 shadow touch-none'

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950" role="dialog" aria-modal="true" aria-label="Crop photo">
      <div className="p-3 text-center text-sm text-white/80">Drag the corners to frame just the nameplate</div>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
        {url && (
          <div ref={frameRef} className="relative touch-none select-none" onPointerMove={onMove} onPointerUp={end} onPointerCancel={end}>
            <img src={url} alt="Photo to crop" draggable={false} className="block max-h-[calc(100dvh-11rem)] max-w-full" />
            <div
              data-testid="crop-frame"
              onPointerDown={begin('move')}
              className="absolute cursor-move border-2 border-white shadow-[0_0_0_9999px_rgba(2,6,23,0.6)]"
              style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }}
            >
              {/* Rule-of-thirds guides help line up the plate. */}
              <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
                {Array.from({ length: 9 }, (_, i) => (
                  <span key={i} className="border border-white/20" />
                ))}
              </div>
              <span onPointerDown={begin('nw')} aria-label="Top-left corner" data-handle="nw" className={`${corner} top-0 left-0 cursor-nwse-resize`} />
              <span onPointerDown={begin('ne')} aria-label="Top-right corner" data-handle="ne" className={`${corner} top-0 right-0 cursor-nesw-resize`} />
              <span onPointerDown={begin('sw')} aria-label="Bottom-left corner" data-handle="sw" className={`${corner} bottom-0 left-0 cursor-nesw-resize`} />
              <span onPointerDown={begin('se')} aria-label="Bottom-right corner" data-handle="se" className={`${corner} right-0 bottom-0 cursor-nwse-resize`} />
            </div>
          </div>
        )}
      </div>

      {error && <p className="px-4 text-center text-sm text-red-300">{error}</p>}
      <div className="grid grid-cols-3 gap-2 p-3 safe-bottom">
        <Button variant="overlay" size="lg" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="overlay" size="lg" icon={<RetakeIcon className="-scale-x-100" />} onClick={() => void rotate()} disabled={busy}>
          Rotate
        </Button>
        <Button size="lg" icon={busy ? <Spinner className="size-5" /> : undefined} onClick={() => void apply()} disabled={busy}>
          Apply
        </Button>
      </div>
    </div>
  )
}
