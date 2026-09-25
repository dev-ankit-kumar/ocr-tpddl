import { useInstallPrompt } from '../hooks/useInstallPrompt'
import { Button } from './Button'
import { DownloadIcon } from './icons'

/** "Install app" where the browser supports it; Add-to-Home-Screen steps on iOS; nothing once installed. */
export function InstallAppButton() {
  const { canInstall, showIosHint, install } = useInstallPrompt()

  if (canInstall) {
    return (
      <Button variant="secondary" icon={<DownloadIcon />} onClick={() => void install()} fullWidth className="sm:w-auto">
        Install app
      </Button>
    )
  }
  if (showIosHint) {
    return (
      <p className="rounded-xl bg-white px-3.5 py-3 text-sm text-slate-600 ring-1 ring-slate-200">
        <span className="font-semibold text-slate-800">Use it like an app:</span> tap <span className="font-semibold">Share</span>, then{' '}
        <span className="font-semibold">Add to Home Screen</span>.
      </p>
    )
  }
  return null
}
