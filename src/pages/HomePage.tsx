import { Button } from '../components/Button'
import { BoltIcon, CameraIcon, ShieldIcon, TableIcon } from '../components/icons'
import { Logo } from '../components/Logo'
import { PrivacyNote } from '../components/PrivacyNote'

const STEPS = ['Scan', 'Capture', 'Extract', 'Review', 'Download']

const FEATURES = [
  { icon: <ShieldIcon />, title: 'Private by design', text: 'OCR runs in your browser. Nothing is uploaded.' },
  { icon: <TableIcon />, title: 'Smart tables', text: 'Rows, columns and key–value pairs are detected automatically.' },
  { icon: <BoltIcon />, title: 'Edit, then export', text: 'Fix anything OCR missed and download a real .xlsx file.' },
]

export function HomePage({ onStart }: { onStart: () => void }) {
  return (
    <main className="mx-auto flex min-h-full max-w-xl flex-col px-5 pt-10 safe-bottom sm:pt-16">
      <Logo large />
      <h1 className="mt-8 text-4xl font-bold leading-tight tracking-tight text-slate-900 sm:text-5xl">
        Turn documents into Excel in seconds
      </h1>
      <p className="mt-4 text-base leading-relaxed text-slate-600">
        Photograph a receipt, invoice, price list or any printed table. SnapSheet reads it, lays it out in rows and columns, and
        hands you a spreadsheet.
      </p>

      <ol className="mt-6 flex flex-wrap items-center gap-x-1.5 gap-y-2 text-xs font-medium text-slate-500" aria-label="How it works">
        {STEPS.map((step, i) => (
          <li key={step} className="flex items-center gap-1.5">
            <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-slate-200">{step}</span>
            {i < STEPS.length - 1 && <span aria-hidden="true">→</span>}
          </li>
        ))}
      </ol>

      <div className="mt-8">
        <Button size="lg" icon={<CameraIcon />} onClick={onStart} fullWidth className="sm:w-auto">
          Scan Document
        </Button>
        <PrivacyNote className="mt-4" />
      </div>

      <ul className="mt-10 grid gap-3 pb-8 sm:grid-cols-3">
        {FEATURES.map((f) => (
          <li key={f.title} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <span className="flex size-9 items-center justify-center rounded-lg bg-brand-50 text-lg text-brand-700">{f.icon}</span>
            <p className="mt-3 text-sm font-semibold text-slate-900">{f.title}</p>
            <p className="mt-1 text-sm text-slate-600">{f.text}</p>
          </li>
        ))}
      </ul>
    </main>
  )
}
