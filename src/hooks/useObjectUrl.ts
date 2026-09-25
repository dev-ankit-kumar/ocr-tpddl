import { useEffect, useState } from 'react'

/** Creates an object URL for a Blob and revokes it when the Blob changes or the component unmounts. */
export function useObjectUrl(blob: Blob | null): string | null {
  const [entry, setEntry] = useState<{ blob: Blob; url: string } | null>(null)

  useEffect(() => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    // Syncing with an external resource (the object URL) is what effects are for.
    // oxlint-disable-next-line react/set-state-in-effect
    setEntry({ blob, url })
    return () => URL.revokeObjectURL(url)
  }, [blob])

  // Ignore a stale URL left over from a previous blob.
  return entry && entry.blob === blob ? entry.url : null
}
