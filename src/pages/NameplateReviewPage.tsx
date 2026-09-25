import { useMemo, useState } from 'react'
import { Alert } from '../components/Alert'
import { AppHeader } from '../components/AppHeader'
import { Button } from '../components/Button'
import { CameraIcon, TableIcon } from '../components/icons'
import { PhotoViewer } from '../components/PhotoViewer'
import { Spinner } from '../components/Spinner'
import { useObjectUrl } from '../hooks/useObjectUrl'
import type { RegisterRecord } from '../hooks/useRegister'
import { FIELDS, type FieldReading, type NameplateField } from '../services/nameplate/extractNameplate'
import { MAKERS } from '../services/nameplate/makers'
import type { NameplateScan } from '../services/nameplate/scanNameplate'
import { makeThumbnail } from '../utils/thumbnail'

type Draft = Omit<RegisterRecord, 'id' | 'savedAt'>

interface NameplateReviewPageProps {
  image: Blob
  scan: NameplateScan
  /** Makes already used in the register, offered as suggestions. */
  knownMakes: string[]
  savedCount: number
  onSave: (record: Draft, then: 'scan' | 'register') => void
  onRetake: () => void
}

const INPUT_MODE: Record<NameplateField, 'text' | 'numeric'> = { make: 'text', serial: 'text', kva: 'numeric', year: 'numeric' }

const STATUS_STYLE = {
  ok: { badge: 'bg-emerald-100 text-emerald-800', ring: 'ring-slate-300', label: 'Read ✓' },
  check: { badge: 'bg-amber-100 text-amber-900', ring: 'ring-amber-400 bg-amber-50', label: 'Check' },
  missing: { badge: 'bg-rose-100 text-rose-800', ring: 'ring-rose-300 bg-rose-50', label: 'Enter' },
} as const

/** Checks and corrects the four fields read from one nameplate before saving. */
export function NameplateReviewPage({ image, scan, knownMakes, savedCount, onSave, onRetake }: NameplateReviewPageProps) {
  const photoUrl = useObjectUrl(image)
  const [zoom, setZoom] = useState(false)
  const [saving, setSaving] = useState<'scan' | 'register' | null>(null)
  const [values, setValues] = useState<Record<NameplateField, string>>(() =>
    Object.fromEntries(FIELDS.map(({ key }) => [key, scan.readings[key].value])) as Record<NameplateField, string>,
  )
  // Fields the user still has to look at: anything the app wasn't sure about.
  const [unverified, setUnverified] = useState<Set<NameplateField>>(
    () => new Set(FIELDS.filter(({ key }) => scan.readings[key].status !== 'ok').map(({ key }) => key)),
  )

  const makeOptions = useMemo(() => [...new Set([...knownMakes, ...MAKERS.map((m) => m.name)])], [knownMakes])
  const empty = FIELDS.filter(({ key }) => !values[key].trim())

  const setValue = (key: NameplateField, value: string) => {
    setValues((v) => ({ ...v, [key]: value }))
    // Typing a value counts as checking it.
    setUnverified((u) => {
      const next = new Set(u)
      next.delete(key)
      return next
    })
  }

  const confirm = (key: NameplateField) =>
    setUnverified((u) => {
      const next = new Set(u)
      next.delete(key)
      return next
    })

  const save = async (then: 'scan' | 'register') => {
    setSaving(then)
    const trimmed = Object.fromEntries(FIELDS.map(({ key }) => [key, values[key].trim()])) as Record<NameplateField, string>
    onSave({ ...trimmed, unverified: FIELDS.map((f) => f.key).filter((k) => unverified.has(k)), thumbnail: await makeThumbnail(image) }, then)
  }

  const pending = unverified.size

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader title="Check nameplate" onBack={onRetake} />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-3 pt-4 pb-32 sm:px-4 sm:pb-8">
        {pending === 0 ? (
          <Alert tone="info" title="All fields read">
            Give them a quick look against the plate, then save.
          </Alert>
        ) : (
          <Alert tone="warning" title={`${pending} field${pending === 1 ? '' : 's'} to check`}>
            Highlighted fields were hard to read. Compare them with the photo (tap it to zoom), correct them, or tap
            <strong> Looks right</strong>.
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          {photoUrl && (
            <button
              type="button"
              onClick={() => setZoom(true)}
              className="group relative overflow-hidden rounded-2xl bg-slate-900 ring-1 ring-slate-200"
              aria-label="Zoom into the photo"
            >
              <img src={photoUrl} alt="Nameplate" className="max-h-[32vh] w-full object-contain sm:max-h-[70vh]" />
              <span className="absolute right-2 bottom-2 rounded-lg bg-black/60 px-2 py-1 text-xs font-medium text-white">Tap to zoom</span>
            </button>
          )}

          <div className="flex flex-col gap-3">
            {FIELDS.map(({ key, label }) => {
              const reading: FieldReading = scan.readings[key]
              const status = unverified.has(key) ? (values[key].trim() ? 'check' : 'missing') : 'ok'
              const style = STATUS_STYLE[status]
              const id = `field-${key}`
              return (
                <div key={key} className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <label htmlFor={id} className="text-sm font-semibold text-slate-800">
                      {label}
                    </label>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${style.badge}`}>{style.label}</span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      id={id}
                      value={values[key]}
                      onChange={(e) => setValue(key, e.target.value)}
                      inputMode={INPUT_MODE[key]}
                      list={key === 'make' ? 'make-options' : undefined}
                      autoComplete="off"
                      autoCapitalize="characters"
                      placeholder={status === 'missing' ? 'Type it from the photo' : ''}
                      className={`h-12 min-w-0 flex-1 rounded-xl border-0 px-3 text-lg font-semibold tracking-wide text-slate-900 ring-1 outline-none focus:ring-2 focus:ring-brand-500 ${style.ring}`}
                    />
                    {status === 'check' && (
                      <Button variant="secondary" onClick={() => confirm(key)} className="shrink-0">
                        Looks right
                      </Button>
                    )}
                  </div>
                  {unverified.has(key) && reading.note && <p className="mt-1.5 text-xs text-amber-800">{reading.note}</p>}
                  {!unverified.has(key) && reading.status === 'ok' && reading.note && <p className="mt-1.5 text-xs text-emerald-700">{reading.note}</p>}
                </div>
              )
            })}
            <datalist id="make-options">
              {makeOptions.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>
        </div>

        {empty.length > 0 && (
          <p className="text-xs text-slate-500">
            Empty: {empty.map((f) => f.label).join(', ')}. You can still save and fill them in later in the register.
          </p>
        )}

        <div className="hidden justify-end gap-2 sm:flex">
          <Button variant="secondary" icon={<TableIcon />} onClick={() => void save('register')} disabled={saving !== null}>
            Save &amp; view register
          </Button>
          <Button icon={saving === 'scan' ? <Spinner className="size-4" /> : <CameraIcon />} onClick={() => void save('scan')} disabled={saving !== null}>
            Save &amp; scan next
          </Button>
        </div>
        {savedCount > 0 && <p className="text-center text-xs text-slate-500 sm:text-right">{savedCount} nameplate(s) saved in the register so far.</p>}
      </main>

      {/* Mobile action bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-3 pt-3 backdrop-blur safe-bottom sm:hidden">
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <Button variant="secondary" size="lg" icon={<TableIcon />} onClick={() => void save('register')} disabled={saving !== null} aria-label="Save and view register">
            Save
          </Button>
          <Button size="lg" icon={saving === 'scan' ? <Spinner className="size-5" /> : <CameraIcon />} onClick={() => void save('scan')} disabled={saving !== null}>
            Save &amp; scan next
          </Button>
        </div>
      </div>

      {zoom && photoUrl && <PhotoViewer src={photoUrl} onClose={() => setZoom(false)} />}
    </div>
  )
}
