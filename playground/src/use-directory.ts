import { useState, useEffect, useCallback } from 'react'
import type { IFS, FileEntry } from 'opfs-extended'

export function useDirectory(fs: IFS | null, dirPath: string) {
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!fs) return
    try {
      const items = await fs.ls(dirPath)
      setEntries(items.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
        return a.name.localeCompare(b.name)
      }))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setEntries([])
    }
  }, [fs, dirPath])

  useEffect(() => {
    refresh()
    if (!fs) return
    const unsub = fs.watch(dirPath, () => { refresh() })
    return unsub
  }, [fs, dirPath, refresh])

  return { entries, error, refresh }
}
