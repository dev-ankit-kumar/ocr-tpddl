import { useId } from 'react'
import type { SplitMode } from '../types'
import { Button } from './Button'
import { TableIcon } from './icons'

const SPLIT_OPTIONS: { value: SplitMode; label: string }[] = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'multi-space', label: 'Multiple spaces' },
  { value: 'space', label: 'Single spaces' },
  { value: 'tab', label: 'Tabs' },
  { value: 'comma', label: 'Commas' },
  { value: 'semicolon', label: 'Semicolons' },
  { value: 'pipe', label: 'Pipes ( | )' },
  { value: 'key-value', label: 'Key: value pairs' },
  { value: 'lines', label: 'One column (each line a row)' },
]

interface RawTextEditorProps {
  text: string
  splitMode: SplitMode
  onTextChange: (text: string) => void
  onSplitModeChange: (mode: SplitMode) => void
  onConvert: () => void
}

/** Editable OCR text plus controls to turn it into a table manually. */
export function RawTextEditor({ text, splitMode, onTextChange, onSplitModeChange, onConvert }: RawTextEditorProps) {
  const textId = useId()
  const splitId = useId()
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <label htmlFor={textId} className="text-sm font-semibold text-slate-800">
        Extracted text
      </label>
      <p className="mt-0.5 text-xs text-slate-500">
        Fix any mistakes, put each row on its own line and separate columns consistently (e.g. with commas or 2+ spaces).
      </p>
      <textarea
        id={textId}
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        spellCheck={false}
        rows={14}
        className="mt-3 block w-full resize-y rounded-xl border-0 bg-slate-50 p-3 font-mono text-[13px] leading-relaxed ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-brand-500"
        placeholder="No text was recognised. You can type or paste the data here."
      />
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor={splitId} className="text-xs font-medium text-slate-600">
            Split columns by
          </label>
          <select
            id={splitId}
            value={splitMode}
            onChange={(e) => onSplitModeChange(e.target.value as SplitMode)}
            className="mt-1 block h-11 w-full rounded-xl border-0 bg-white px-3 text-sm ring-1 ring-slate-300 outline-none focus:ring-2 focus:ring-brand-500"
          >
            {SPLIT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <Button icon={<TableIcon />} onClick={onConvert} disabled={!text.trim()}>
          Convert to table
        </Button>
      </div>
      <p className="mt-2 text-xs text-slate-500">Converting replaces the current table with one built from this text.</p>
    </div>
  )
}
