import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import { createRootFromHandle, type IRoot, type IFS } from 'opfs-extended'

interface FSContextValue {
  root: IRoot | null
  fs: IFS | null
  mountPath: string
  mountTo: (subpath: string) => void
  clearAll: () => Promise<void>
}

const FSContext = createContext<FSContextValue | null>(null)

export function FSProvider({ children }: { children: ReactNode }) {
  const [root, setRoot] = useState<IRoot | null>(null)
  const [fs, setFs] = useState<IFS | null>(null)
  const [mountPath, setMountPath] = useState('/')

  // Auto-initialize on mount
  useEffect(() => {
    navigator.storage.getDirectory().then(async (handle) => {
      const newRoot = await createRootFromHandle('opfs-root', handle)
      setRoot(newRoot)
      setFs(newRoot.mount())
    })
  }, [])

  const mountTo = useCallback((subpath: string) => {
    if (!root) return
    const newFs = root.mount(subpath)
    setFs(newFs)
    setMountPath(subpath || '/')
  }, [root])

  const clearAll = useCallback(async () => {
    if (!root) return
    await root.destroy()
    // Re-initialize fresh
    const handle = await navigator.storage.getDirectory()
    const newRoot = await createRootFromHandle('opfs-root', handle)
    setRoot(newRoot)
    setFs(newRoot.mount())
    setMountPath('/')
  }, [root])

  return (
    <FSContext value={{ root, fs, mountPath, mountTo, clearAll }}>
      {children}
    </FSContext>
  )
}

export function useFS(): FSContextValue {
  const ctx = useContext(FSContext)
  if (!ctx) throw new Error('useFS must be used within FSProvider')
  return ctx
}
