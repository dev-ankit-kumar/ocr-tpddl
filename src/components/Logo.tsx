export function Logo({ large = false }: { large?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg viewBox="0 0 32 32" className={large ? 'size-12' : 'size-8'} aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="currentColor" className="text-brand-700" />
        <path d="M9 8h9l5 5v11a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" fill="#fff" />
        <path d="M11 16h10M11 19.5h10M11 23h10M15.5 14v10" stroke="currentColor" strokeWidth="1.5" className="text-brand-700" />
      </svg>
      <span className={`font-bold tracking-tight text-slate-900 ${large ? 'text-3xl' : 'text-lg'}`}>
        Snap<span className="text-brand-700">Sheet</span>
      </span>
    </span>
  )
}
