import { useCallback, useEffect, useState } from 'react'
import type { NameplateField } from '../services/nameplate/extractNameplate'

/** One saved transformer nameplate. */
export interface RegisterRecord {
  id: string
  /** ISO timestamp of when it was saved. */
  savedAt: string
  make: string
  serial: string
  kva: string
  year: string
  /** Fields the user hasn't verified yet (highlighted in the register and in Excel). */
  unverified: NameplateField[]
  /** Small JPEG data URL of the plate photo, for checking later. */
  thumbnail?: string
}

const STORAGE_KEY = 'snapsheet.register.v1'

function load(): RegisterRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as RegisterRecord[]) : []
  } catch {
    return []
  }
}

/** Saves the register; if storage is full, drops photo thumbnails rather than data. */
function persist(records: RegisterRecord[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
    return true
  } catch {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records.map(({ thumbnail: _t, ...r }) => r)))
    } catch {
      // Storage unavailable (private mode): the register still works for this session.
    }
    return false
  }
}

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)

/**
 * The list of scanned nameplates, kept on this device (localStorage) so a closed
 * tab or a crash never loses a day's field work. Shared across components via a
 * storage event so every screen shows the same list.
 */
export function useRegister() {
  const [records, setRecords] = useState<RegisterRecord[]>(load)
  const [storageFull, setStorageFull] = useState(false)

  // Keep in sync with other tabs / other components using the hook.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null) setRecords(load())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const commit = useCallback((next: RegisterRecord[]) => {
    setStorageFull(!persist(next))
    setRecords(next)
  }, [])

  const add = useCallback(
    (record: Omit<RegisterRecord, 'id' | 'savedAt'>) => {
      const next = [...load(), { ...record, id: newId(), savedAt: new Date().toISOString() }]
      commit(next)
      return next.length
    },
    [commit],
  )

  const update = useCallback((id: string, patch: Partial<RegisterRecord>) => commit(load().map((r) => (r.id === id ? { ...r, ...patch } : r))), [commit])
  const remove = useCallback((id: string) => commit(load().filter((r) => r.id !== id)), [commit])
  const clear = useCallback(() => commit([]), [commit])

  return { records, add, update, remove, clear, storageFull }
}
