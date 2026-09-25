import { useRef, type ReactNode } from 'react'
import { Button } from './Button'

interface FilePickerButtonProps {
  onFile: (file: File) => void
  children: ReactNode
  icon?: ReactNode
  variant?: 'primary' | 'secondary' | 'overlay'
  className?: string
  fullWidth?: boolean
}

/** Opens the gallery / file picker for a single image. */
export function FilePickerButton({ onFile, children, icon, variant = 'secondary', className, fullWidth }: FilePickerButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = '' // allow picking the same file twice
          if (file) onFile(file)
        }}
      />
      <Button variant={variant} icon={icon} className={className} fullWidth={fullWidth} onClick={() => inputRef.current?.click()}>
        {children}
      </Button>
    </>
  )
}
