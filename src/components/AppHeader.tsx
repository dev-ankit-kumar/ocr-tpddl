import type { ReactNode } from 'react'
import { ArrowLeftIcon } from './icons'
import { Logo } from './Logo'

interface AppHeaderProps {
  title?: string
  onBack?: () => void
  actions?: ReactNode
}

export function AppHeader({ title, onBack, actions }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Go back"
            className="-ml-2 flex size-10 items-center justify-center rounded-full text-xl text-slate-700 hover:bg-slate-100"
          >
            <ArrowLeftIcon />
          </button>
        ) : (
          <Logo />
        )}
        {title && <h1 className="truncate text-base font-semibold">{title}</h1>}
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      </div>
    </header>
  )
}
