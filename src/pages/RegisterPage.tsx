import { useState } from 'react'
import { Alert } from '../components/Alert'
import { AppHeader } from '../components/AppHeader'
import { Button } from '../components/Button'
import { CameraIcon, DownloadIcon, TrashIcon } from '../components/icons'
import { PhotoViewer } from '../components/PhotoViewer'
import { PrivacyNote } from '../components/PrivacyNote'
import { Spinner } from '../components/Spinner'
import { useRegister, type RegisterRecord } from '../hooks/useRegister'
import { FIELDS, type NameplateField } from '../services/nameplate/extractNameplate'
import { downloadRegister } from '../services/nameplate/registerExport'

interface RegisterPageProps {
  onBack: () => void
  onScan: () => void
}

/** All saved nameplates: edit, delete, and download as one formatted Excel file. */
export function RegisterPage({ onBack, onScan }: RegisterPageProps) {
  const { records, update, remove, clear, storageFull } = useRegister()
  const [downloading, setDownloading] = useState(false)
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null)
  const [photo, setPhoto] = useState<string | null>(null)
  const unverified = records.reduce((n, r) => n + r.unverified.length, 0)

  const edit = (record: RegisterRecord, key: NameplateField, value: string) =>
    update(record.id, { [key]: value, unverified: record.unverified.filter((k) => k !== key) })

  const handleDownload = async () => {
    setDownloading(true)
    setMessage(null)
    try {
      const name = await downloadRegister(records)
      setMessage({ tone: 'info', text: `Saved ${name} to your downloads.` })
    } catch (err) {
      console.error(err)
      setMessage({ tone: 'error', text: 'The Excel file could not be created. Please try again.' })
    } finally {
      setDownloading(false)
    }
  }

  const handleClear = () => {
    if (window.confirm(`Delete all ${records.length} saved nameplates from this device? Download the Excel file first if you need it.`)) clear()
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader
        title={`Register (${records.length})`}
        onBack={onBack}
        actions={
          records.length > 0 && (
            <div className="hidden sm:block">
              <Button size="sm" icon={downloading ? <Spinner className="size-4" /> : <DownloadIcon />} onClick={handleDownload} disabled={downloading}>
                Download Excel
              </Button>
            </div>
          )
        }
      />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-3 pt-4 pb-28 sm:px-4 sm:pb-8">
        {records.length === 0 ? (
          <div className="mt-10 flex flex-col items-center gap-4 text-center">
            <p className="text-slate-600">No nameplates saved yet.</p>
            <Button size="lg" icon={<CameraIcon />} onClick={onScan}>
              Scan Nameplate
            </Button>
          </div>
        ) : (
          <>
            {unverified > 0 && (
              <Alert tone="warning">
                {unverified} value{unverified === 1 ? '' : 's'} not verified yet (highlighted). They'll also be highlighted in the Excel file.
              </Alert>
            )}
            {storageFull && <Alert tone="warning">This device's storage is full, so photo thumbnails are no longer saved. Your data is safe.</Alert>}

            {/* Phones: one card per nameplate, so all four values fit without scrolling sideways. */}
            <ul className="flex flex-col gap-3 sm:hidden">
              {records.map((record, i) => (
                <li key={record.id} className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
                  <div className="mb-2 flex items-center gap-3">
                    <span className="text-sm font-semibold text-slate-400 tabular-nums">#{i + 1}</span>
                    {record.thumbnail && (
                      <button type="button" onClick={() => setPhoto(record.thumbnail!)} aria-label={`Photo of nameplate ${i + 1}`}>
                        <img src={record.thumbnail} alt="" className="h-10 w-8 rounded object-cover ring-1 ring-slate-200" />
                      </button>
                    )}
                    <span className="flex-1 truncate text-xs text-slate-400">{new Date(record.savedAt).toLocaleString()}</span>
                    <button
                      type="button"
                      onClick={() => window.confirm(`Delete nameplate ${i + 1}?`) && remove(record.id)}
                      aria-label={`Delete nameplate ${i + 1}`}
                      className="flex size-8 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {FIELDS.map((f) => {
                      const flagged = record.unverified.includes(f.key)
                      return (
                        <label key={f.key} className="flex flex-col gap-0.5">
                          <span className="text-xs font-medium text-slate-500">{f.label}</span>
                          <input
                            value={record[f.key]}
                            onChange={(e) => edit(record, f.key, e.target.value)}
                            className={`h-10 min-w-0 rounded-lg border-0 px-2 font-semibold ring-1 outline-none focus:ring-2 focus:ring-brand-500 ${
                              flagged ? 'bg-amber-50 ring-amber-300' : 'ring-slate-200'
                            }`}
                          />
                        </label>
                      )
                    })}
                  </div>
                </li>
              ))}
            </ul>

            <div className="hidden overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 sm:block">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr className="bg-slate-100 text-left text-xs font-semibold text-slate-600">
                      <th className="border-b border-slate-200 px-3 py-2.5">#</th>
                      <th className="border-b border-slate-200 px-2 py-2.5">Photo</th>
                      {FIELDS.map((f) => (
                        <th key={f.key} className="border-b border-slate-200 px-2 py-2.5">
                          {f.label}
                        </th>
                      ))}
                      <th className="border-b border-slate-200" />
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((record, i) => (
                      <tr key={record.id}>
                        <td className="border-b border-slate-100 px-3 text-slate-400 tabular-nums">{i + 1}</td>
                        <td className="border-b border-slate-100 px-2 py-1.5">
                          {record.thumbnail ? (
                            <button type="button" onClick={() => setPhoto(record.thumbnail!)} aria-label={`Photo of nameplate ${i + 1}`}>
                              <img src={record.thumbnail} alt="" className="h-10 w-8 rounded object-cover ring-1 ring-slate-200" />
                            </button>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>
                        {FIELDS.map((f) => {
                          const flagged = record.unverified.includes(f.key)
                          return (
                            <td key={f.key} className="border-b border-slate-100 px-1 py-1">
                              <input
                                value={record[f.key]}
                                onChange={(e) => edit(record, f.key, e.target.value)}
                                aria-label={`${f.label}, row ${i + 1}`}
                                title={flagged ? 'Not verified — check against the nameplate' : undefined}
                                className={`h-9 w-full min-w-0 rounded-lg border-0 px-2 font-medium outline-none focus:ring-2 focus:ring-brand-500 ${
                                  flagged ? 'bg-amber-50 ring-1 ring-amber-300' : 'bg-transparent'
                                }`}
                              />
                            </td>
                          )
                        })}
                        <td className="border-b border-slate-100 px-1 text-right">
                          <button
                            type="button"
                            onClick={() => window.confirm(`Delete row ${i + 1}?`) && remove(record.id)}
                            aria-label={`Delete row ${i + 1}`}
                            className="flex size-8 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600"
                          >
                            <TrashIcon />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {message && <Alert tone={message.tone}>{message.text}</Alert>}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button variant="danger" size="sm" icon={<TrashIcon />} onClick={handleClear}>
                Clear register
              </Button>
              <div className="hidden gap-2 sm:flex">
                <Button variant="secondary" icon={<CameraIcon />} onClick={onScan}>
                  Scan next
                </Button>
                <Button icon={downloading ? <Spinner className="size-4" /> : <DownloadIcon />} onClick={handleDownload} disabled={downloading}>
                  Download Excel
                </Button>
              </div>
            </div>
            <PrivacyNote />
          </>
        )}
      </main>

      {records.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-3 pt-3 backdrop-blur safe-bottom sm:hidden">
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <Button variant="secondary" size="lg" icon={<CameraIcon />} onClick={onScan}>
              Scan
            </Button>
            <Button size="lg" icon={downloading ? <Spinner className="size-5" /> : <DownloadIcon />} onClick={handleDownload} disabled={downloading}>
              Download Excel
            </Button>
          </div>
        </div>
      )}

      {photo && <PhotoViewer src={photo} onClose={() => setPhoto(null)} />}
    </div>
  )
}
