import { ShieldIcon } from './icons'

export function PrivacyNote({ className = '' }: { className?: string }) {
  return (
    <p className={`flex items-start gap-2 text-xs leading-relaxed text-slate-500 ${className}`}>
      <ShieldIcon className="mt-px shrink-0 text-sm text-brand-600" />
      <span>Your document is processed on your device and is not uploaded to our servers.</span>
    </p>
  )
}
