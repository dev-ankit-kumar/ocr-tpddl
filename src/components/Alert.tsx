import type { ReactNode } from 'react'
import { AlertIcon } from './icons'

type Tone = 'error' | 'warning' | 'info'

const TONES: Record<Tone, string> = {
  error: 'bg-red-50 text-red-800 ring-red-200',
  warning: 'bg-amber-50 text-amber-900 ring-amber-200',
  info: 'bg-brand-50 text-brand-900 ring-brand-200',
}

interface AlertProps {
  tone?: Tone
  title?: string
  children: ReactNode
  action?: ReactNode
}

export function Alert({ tone = 'info', title, children, action }: AlertProps) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex gap-3 rounded-xl p-3.5 text-sm ring-1 ${TONES[tone]}`}>
      <AlertIcon className="mt-0.5 shrink-0 text-base" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        <div className={title ? 'mt-0.5' : ''}>{children}</div>
        {action && <div className="mt-2.5">{action}</div>}
      </div>
    </div>
  )
}
