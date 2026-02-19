import type { IRoot, UsageStats, WatchEvent } from './types.ts'
import { createBroadcast } from './broadcast.ts'
import { writeMeta, defaultDirMeta } from './meta.ts'
import { isMetaFile } from './path.ts'
import { Mount } from './mount.ts'

type DirCallback = (events: WatchEvent[]) => void

/** Singleton root instance. Only one root per runtime. */
let activeRoot: Root | undefined

/**
 * Internal Root implementation.
 * Manages an OPFS directory, subscriber map, and cross-worker broadcast.
 */
export class Root implements IRoot {
  readonly opfsPath: string
  readonly dirHandle: FileSystemDirectoryHandle
  /** When true, destroy clears contents instead of removing the directory itself. */
  readonly isExternalHandle: boolean
  private subscribers = new Map<string, Set<DirCallback>>()
  private broadcast: ReturnType<typeof createBroadcast>
  private broadcastUnsub: (() => void) | undefined

  constructor(opfsPath: string, dirHandle: FileSystemDirectoryHandle, isExternalHandle = false) {
    this.opfsPath = opfsPath
    this.dirHandle = dirHandle
    this.isExternalHandle = isExternalHandle
    this.broadcast = createBroadcast()
    this.broadcastUnsub = this.broadcast.subscribe((dirPath, events) => {
      this.fireLocal(dirPath, events)
    })
  }

  /** Create a mount scoped to an optional subpath within this root. */
  mount(subpath?: string): Mount {
    const mountBase = subpath ? `/${subpath.replace(/^\/+/, '')}` : '/'
    return new Mount(this, mountBase)
  }

  /** Recursively delete the entire root from OPFS and clean up. */
  async destroy(): Promise<void> {
    if (this.isExternalHandle) {
      // Can't remove the root itself - clear all children instead
      for await (const [name] of this.dirHandle.entries()) {
        await this.dirHandle.removeEntry(name, { recursive: true })
      }
    } else {
      const parent = await navigator.storage.getDirectory()
      await parent.removeEntry(this.opfsPath, { recursive: true })
    }
    this.subscribers.clear()
    this.broadcast.destroy()
    this.broadcastUnsub?.()
    if (activeRoot === this) activeRoot = undefined
  }

  /** Calculate storage usage by recursively walking the OPFS tree. */
  async usage(): Promise<UsageStats> {
    return walkUsage(this.dirHandle)
  }

  /** Register a directory-level watcher. Returns unsubscribe fn. */
  addSubscriber(dirPath: string, callback: DirCallback): () => void {
    let set = this.subscribers.get(dirPath)
    if (!set) {
      set = new Set()
      this.subscribers.set(dirPath, set)
    }
    set.add(callback)
    return () => {
      set.delete(callback)
      if (set.size === 0) this.subscribers.delete(dirPath)
    }
  }

  /** Notify local subscribers and broadcast to other workers. */
  notifySubscribers(dirPath: string, events: WatchEvent[]): void {
    this.fireLocal(dirPath, events)
    this.broadcast.notify(dirPath, events)
  }

  /** Fire callbacks for all subscribers whose watched path is a prefix of the event path. */
  private fireLocal(dirPath: string, events: WatchEvent[]): void {
    const dirWithSlash = dirPath === '/' ? '/' : `${dirPath}/`
    for (const [watchedPath, set] of this.subscribers) {
      // Match if the watched path is the event dir, or is a prefix of it
      if (watchedPath === dirPath) {
        for (const cb of set) {
          try { cb(events) } catch { /* subscriber errors are swallowed */ }
        }
      } else {
        const prefix = watchedPath === '/' ? '/' : `${watchedPath}/`
        if (dirWithSlash.startsWith(prefix)) {
          for (const cb of set) {
            try { cb(events) } catch { /* subscriber errors are swallowed */ }
          }
        }
      }
    }
  }
}

/**
 * Get or create a Root for the given OPFS path.
 * Singleton - calling with the same path returns the same instance.
 */
export async function createRoot(opfsPath: string): Promise<Root> {
  if (activeRoot) return activeRoot

  const parent = await navigator.storage.getDirectory()
  const dirHandle = await parent.getDirectoryHandle(opfsPath, { create: true })

  return initRoot(opfsPath, dirHandle)
}

/**
 * Create a Root from an existing FileSystemDirectoryHandle.
 * Useful for mounting the actual OPFS root via `navigator.storage.getDirectory()`.
 */
export async function createRootFromHandle(
  key: string,
  dirHandle: FileSystemDirectoryHandle,
): Promise<Root> {
  if (activeRoot) return activeRoot

  return initRoot(key, dirHandle, true)
}

async function initRoot(key: string, dirHandle: FileSystemDirectoryHandle, isExternalHandle = false): Promise<Root> {
  // Ensure root .meta exists
  try {
    await dirHandle.getFileHandle('.meta')
  } catch {
    await writeMeta(dirHandle, defaultDirMeta())
  }

  const root = new Root(key, dirHandle, isExternalHandle)
  activeRoot = root
  return root
}

/** Recursively walk an OPFS directory to compute usage stats. */
async function walkUsage(dirHandle: FileSystemDirectoryHandle): Promise<UsageStats> {
  let totalSize = 0
  let fileCount = 0
  let directoryCount = 0

  for await (const [name, handle] of dirHandle.entries()) {
    if (isMetaFile(name)) continue

    if (handle.kind === 'file') {
      const file = await (handle as FileSystemFileHandle).getFile()
      totalSize += file.size
      fileCount++
    } else {
      directoryCount++
      const sub = await walkUsage(handle as FileSystemDirectoryHandle)
      totalSize += sub.totalSize
      fileCount += sub.fileCount
      directoryCount += sub.directoryCount
    }
  }

  return { totalSize, fileCount, directoryCount }
}
