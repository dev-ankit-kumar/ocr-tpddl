export function ProgressBar({ value, label }: { value: number; label: string }) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between text-sm">
        <span className="font-medium text-slate-700" aria-live="polite">
          {label}
        </span>
        <span className="tabular-nums text-slate-500">{percent}%</span>
      </div>
      <div
        className="h-2.5 overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={label}
      >
        <div className="h-full rounded-full bg-brand-600 transition-[width] duration-300 ease-out" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}
