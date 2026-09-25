import { useEffect } from 'react'
import { CloseIcon } from './icons'

/** Full-screen, scrollable (and pinch-zoomable) view of a photo, for reading faint values. */
export function PhotoViewer({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95" role="dialog" aria-modal="true" aria-label="Photo">
      <div className="flex items-center justify-between p-3 text-sm text-white/80">
        <span>Pinch or scroll to zoom</span>
        <button type="button" onClick={onClose} aria-label="Close photo" className="flex size-10 items-center justify-center rounded-full bg-white/10 text-xl text-white">
          <CloseIcon />
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        <img src={src} alt="Nameplate photo" className="mx-auto max-w-none" style={{ width: 'max(100%, 900px)' }} />
      </div>
    </div>
  )
}
