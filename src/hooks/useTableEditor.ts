import { useCallback, useReducer } from 'react'
import type { TableData } from '../types'
import { createHeaders } from '../utils/text'

type Action =
  | { type: 'set-cell'; row: number; col: number; value: string }
  | { type: 'set-header'; col: number; value: string }
  | { type: 'add-row'; at?: number }
  | { type: 'remove-row'; row: number }
  | { type: 'add-column'; at?: number }
  | { type: 'remove-column'; col: number }
  | { type: 'replace'; table: TableData }

const emptyRow = (width: number) => Array.from({ length: width }, () => ({ value: '' }))

function reducer(state: TableData, action: Action): TableData {
  switch (action.type) {
    case 'set-cell':
      return {
        ...state,
        rows: state.rows.map((r, ri) =>
          ri === action.row ? r.map((c, ci) => (ci === action.col ? { value: action.value } : c)) : r,
        ),
      }
    case 'set-header':
      return { ...state, headers: state.headers.map((h, i) => (i === action.col ? action.value : h)) }
    case 'add-row': {
      const rows = [...state.rows]
      rows.splice(action.at ?? rows.length, 0, emptyRow(state.headers.length))
      return { ...state, rows }
    }
    case 'remove-row':
      return { ...state, rows: state.rows.filter((_, i) => i !== action.row) }
    case 'add-column': {
      const at = action.at ?? state.headers.length
      const headers = [...state.headers]
      headers.splice(at, 0, createHeaders(1, state.headers.length + 1)[0])
      const rows = state.rows.map((r) => {
        const next = [...r]
        next.splice(at, 0, { value: '' })
        return next
      })
      return { headers, rows }
    }
    case 'remove-column':
      if (state.headers.length <= 1) return state
      return {
        headers: state.headers.filter((_, i) => i !== action.col),
        rows: state.rows.map((r) => r.filter((_, i) => i !== action.col)),
      }
    case 'replace':
      return action.table
  }
}

/** Immutable editing operations for the review table. */
export function useTableEditor(initial: TableData) {
  const [table, dispatch] = useReducer(reducer, initial)

  return {
    table,
    setCell: useCallback((row: number, col: number, value: string) => dispatch({ type: 'set-cell', row, col, value }), []),
    setHeader: useCallback((col: number, value: string) => dispatch({ type: 'set-header', col, value }), []),
    addRow: useCallback((at?: number) => dispatch({ type: 'add-row', at }), []),
    removeRow: useCallback((row: number) => dispatch({ type: 'remove-row', row }), []),
    addColumn: useCallback((at?: number) => dispatch({ type: 'add-column', at }), []),
    removeColumn: useCallback((col: number) => dispatch({ type: 'remove-column', col }), []),
    replace: useCallback((next: TableData) => dispatch({ type: 'replace', table: next }), []),
  }
}

export type TableEditor = ReturnType<typeof useTableEditor>
