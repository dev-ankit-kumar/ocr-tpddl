import { memo, useMemo, type KeyboardEvent } from 'react'
import type { TableEditor } from '../hooks/useTableEditor'
import type { Cell } from '../types'
import { CloseIcon, PlusIcon, TrashIcon } from './icons'

const cellInput =
  'block w-full min-w-0 bg-transparent px-2.5 py-2 text-sm outline-none focus:bg-white focus:ring-2 focus:ring-inset focus:ring-brand-500'

/** Enter / Shift+Enter moves to the cell below / above, like a spreadsheet. */
function moveVertically(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key !== 'Enter') return
  e.preventDefault()
  const { row, col } = e.currentTarget.dataset
  const next = Number(row) + (e.shiftKey ? -1 : 1)
  document.querySelector<HTMLInputElement>(`input[data-row="${next}"][data-col="${col}"]`)?.focus()
}

interface RowProps {
  cells: Cell[]
  index: number
  onChange: TableEditor['setCell']
  onRemove: TableEditor['removeRow']
}

// Memoised so typing in one row doesn't re-render every other row.
const Row = memo(function Row({ cells, index, onChange, onRemove }: RowProps) {
  return (
    <tr className="group">
      <td className="sticky left-0 z-10 border-b border-r border-slate-200 bg-slate-50 px-1 text-center">
        <div className="flex items-center justify-between gap-0.5">
          <span className="w-6 text-xs tabular-nums text-slate-400">{index + 1}</span>
          <button
            type="button"
            onClick={() => onRemove(index)}
            aria-label={`Delete row ${index + 1}`}
            title="Delete row"
            className="flex size-7 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600"
          >
            <TrashIcon />
          </button>
        </div>
      </td>
      {cells.map((cell, col) => (
        <td
          key={col}
          className={`border-b border-r border-slate-200 ${cell.uncertain ? 'bg-amber-50' : 'bg-white'}`}
          title={cell.uncertain ? 'Low OCR confidence – please check this value' : undefined}
        >
          <input
            className={cellInput}
            value={cell.value}
            data-row={index}
            data-col={col}
            aria-label={`Row ${index + 1}, column ${col + 1}`}
            onChange={(e) => onChange(index, col, e.target.value)}
            onKeyDown={moveVertically}
          />
        </td>
      ))}
    </tr>
  )
})

/** Spreadsheet-like editor: editable cells and headers, add/remove rows and columns. */
export function EditableTable({ editor }: { editor: TableEditor }) {
  const { table, setCell, setHeader, addRow, removeRow, addColumn, removeColumn } = editor

  // Size columns to their content (in ch), within sensible bounds.
  const widths = useMemo(
    () =>
      table.headers.map((h, c) => {
        const longest = Math.max(h.length, ...table.rows.map((r) => r[c]?.value.length ?? 0))
        return Math.min(36, Math.max(10, longest + 3))
      }),
    [table],
  )

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="max-h-[62vh] overflow-auto overscroll-contain">
        <table className="w-max min-w-full table-fixed border-separate border-spacing-0">
          <colgroup>
            <col style={{ width: '4.75rem' }} />
            {widths.map((w, i) => (
              <col key={i} style={{ width: `${w}ch` }} />
            ))}
            <col style={{ width: '3rem' }} />
          </colgroup>
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="sticky left-0 z-10 border-b border-r border-slate-200 bg-slate-100 text-xs font-medium text-slate-500">#</th>
              {table.headers.map((header, col) => (
                <th key={col} className="border-b border-r border-slate-200 bg-slate-100 p-0">
                  <div className="flex items-center">
                    <input
                      className={`${cellInput} font-semibold text-slate-800`}
                      value={header}
                      aria-label={`Column ${col + 1} name`}
                      onChange={(e) => setHeader(col, e.target.value)}
                    />
                    {table.headers.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeColumn(col)}
                        aria-label={`Delete column ${header || col + 1}`}
                        title="Delete column"
                        className="mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <CloseIcon />
                      </button>
                    )}
                  </div>
                </th>
              ))}
              <th className="border-b border-slate-200 bg-slate-100 p-0">
                <button
                  type="button"
                  onClick={() => addColumn()}
                  aria-label="Add column"
                  title="Add column"
                  className="flex h-10 w-full items-center justify-center text-lg text-brand-700 hover:bg-brand-50"
                >
                  <PlusIcon />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((cells, index) => (
              <Row key={index} cells={cells} index={index} onChange={setCell} onRemove={removeRow} />
            ))}
            {table.rows.length === 0 && (
              <tr>
                <td colSpan={table.headers.length + 2} className="px-4 py-8 text-center text-sm text-slate-500">
                  No rows yet. Add one below or convert the raw text.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={() => addRow()}
        className="flex w-full items-center justify-center gap-1.5 border-t border-slate-200 py-2.5 text-sm font-semibold text-brand-700 hover:bg-brand-50"
      >
        <PlusIcon /> Add row
      </button>
    </div>
  )
}
