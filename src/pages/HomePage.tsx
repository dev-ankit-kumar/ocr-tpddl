import { Button } from '../components/Button'
import { BoltIcon, CameraIcon, ShieldIcon, TableIcon } from '../components/icons'
import { InstallAppButton } from '../components/InstallAppButton'
import { Logo } from '../components/Logo'
import { PrivacyNote } from '../components/PrivacyNote'
import type { ScanMode } from '../types'

const STEPS = ['Scan', 'Capture', 'Extract', 'Review', 'Download']

const FEATURES = [
  { icon: <BoltIcon />, title: 'Nameplates in one tap', text: 'Make, Sr. No, KVA and Year of Mfg are found and checked automatically.' },
  { icon: <TableIcon />, title: 'One Excel for all', text: 'Scan plate after plate; download a formatted register at the end.' },
  { icon: <ShieldIcon />, title: 'Private by design', text: 'OCR runs on your device. Nothing is uploaded.' },
]

interface HomePageProps {
  savedCount: number
  onStart: (mode: ScanMode) => void
  onOpenRegister: () => void
}

export function HomePage({ savedCount, onStart, onOpenRegister }: HomePageProps) {
  return (
    <main className="mx-auto flex min-h-full max-w-xl flex-col px-5 pt-10 safe-bottom sm:pt-16">
      <Logo large />
      <h1 className="mt-8 text-4xl font-bold leading-tight tracking-tight text-slate-900 sm:text-5xl">
        Turn documents into Excel in seconds
      </h1>
      <p className="mt-4 text-base leading-relaxed text-slate-600">
        Photograph transformer nameplates and get a clean Excel register of <strong>Make, Sr. No, KVA</strong> and{' '}
        <strong>Year of Mfg</strong>, or turn any printed table into a spreadsheet.
      </p>

      <ol className="mt-6 flex flex-wrap items-center gap-x-1.5 gap-y-2 text-xs font-medium text-slate-500" aria-label="How it works">
        {STEPS.map((step, i) => (
          <li key={step} className="flex items-center gap-1.5">
            <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-slate-200">{step}</span>
            {i < STEPS.length - 1 && <span aria-hidden="true">→</span>}
          </li>
        ))}
      </ol>

      <div className="mt-8 flex flex-col gap-3">
        <Button size="lg" icon={<CameraIcon />} onClick={() => onStart('nameplate')} fullWidth>
          Scan Nameplate
        </Button>
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" icon={<TableIcon />} onClick={onOpenRegister}>
            Register{savedCount > 0 ? ` (${savedCount})` : ''}
          </Button>
          <Button variant="secondary" icon={<CameraIcon />} onClick={() => onStart('table')}>
            Scan any table
          </Button>
        </div>
        <InstallAppButton />
        <PrivacyNote className="mt-1" />
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
