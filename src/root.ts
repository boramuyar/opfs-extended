import type { IRoot, UsageStats, UsageOptions, FsckResult, CreateRootOptions, WatchEvent } from './types.ts'
import { createBroadcast } from './broadcast.ts'
import { readMeta, writeMeta, defaultDirMeta, withMetaLock } from './meta.ts'
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

  /** Return cached usage stats, or do a full tree walk if requested. */
  async usage(options?: UsageOptions): Promise<UsageStats> {
    if (options?.full) {
      const stats = await walkUsage(this.dirHandle)
      await withMetaLock('/', async () => {
        const meta = await readMeta(this.dirHandle)
        meta.usage = stats
        await writeMeta(this.dirHandle, meta)
      })
      return stats
    }
    const meta = await readMeta(this.dirHandle)
    if (meta.usage) return meta.usage
    // Fallback: no cached stats yet — do a full walk
    return this.usage({ full: true })
  }

  /** Scan OPFS state and repair metadata to match actual entries. */
  async fsck(): Promise<FsckResult> {
    const result = await walkFsck(this.dirHandle)
    // Rebuild cached usage stats after repair
    await this.usage({ full: true })
    return result
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
 * Get or create a Root backed by the OPFS root directory.
 * Singleton — only one root per runtime.
 */
export async function createRoot(options?: CreateRootOptions): Promise<Root> {
  if (activeRoot) return activeRoot

  const dirHandle = await navigator.storage.getDirectory()
  return initRoot('', dirHandle, true, options)
}

/**
 * Create a Root from an existing FileSystemDirectoryHandle.
 * Useful for mounting the actual OPFS root via `navigator.storage.getDirectory()`.
 */
export async function createRootFromHandle(
  key: string,
  dirHandle: FileSystemDirectoryHandle,
  options?: CreateRootOptions,
): Promise<Root> {
  if (activeRoot) return activeRoot

  return initRoot(key, dirHandle, true, options)
}

async function initRoot(key: string, dirHandle: FileSystemDirectoryHandle, isExternalHandle = false, options?: CreateRootOptions): Promise<Root> {
  // Ensure root .meta exists
  try {
    await dirHandle.getFileHandle('.meta')
  } catch {
    await writeMeta(dirHandle, defaultDirMeta())
  }

  const root = new Root(key, dirHandle, isExternalHandle)
  activeRoot = root

  if (options?.autoRepair) {
    await root.fsck()
  } else {
    // Seed cached usage if not present yet (one-time migration)
    const meta = await readMeta(dirHandle)
    if (!meta.usage) {
      await root.usage({ full: true })
    }
  }

  return root
}

/** Recursively walk an OPFS directory and repair .meta to match actual entries. */
async function walkFsck(dirHandle: FileSystemDirectoryHandle): Promise<FsckResult> {
  let repaired = 0
  let entries = 0

  const meta = await readMeta(dirHandle)
  const actualEntries = new Map<string, FileSystemHandle>()

  for await (const [name, handle] of dirHandle.entries()) {
    if (isMetaFile(name)) continue
    actualEntries.set(name, handle)
    entries++
  }

  let changed = false

  // Add entries present in OPFS but missing from .meta
  for (const [name, handle] of actualEntries) {
    if (!meta.children[name]) {
      const now = Date.now()
      if (handle.kind === 'file') {
        const file = await (handle as FileSystemFileHandle).getFile()
        meta.children[name] = { type: 'file', size: file.size, ctime: now, mtime: now, meta: {} }
      } else {
        meta.children[name] = { type: 'directory', ctime: now, mtime: now, meta: {} }
      }
      changed = true
    } else if (handle.kind === 'file') {
      // Update size if it differs
      const file = await (handle as FileSystemFileHandle).getFile()
      if (meta.children[name].size !== file.size) {
        meta.children[name].size = file.size
        changed = true
      }
    }
  }

  // Remove .meta entries not present in OPFS
  for (const name of Object.keys(meta.children)) {
    if (!actualEntries.has(name)) {
      delete meta.children[name]
      changed = true
    }
  }

  if (changed) {
    await writeMeta(dirHandle, meta)
    repaired++
  }

  // Recurse into subdirectories
  for (const [, handle] of actualEntries) {
    if (handle.kind === 'directory') {
      const sub = await walkFsck(handle as FileSystemDirectoryHandle)
      repaired += sub.repaired
      entries += sub.entries
    }
  }

  return { repaired, entries }
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
