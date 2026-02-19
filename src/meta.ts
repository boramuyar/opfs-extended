import type { DirMeta, UsageStats } from './types.ts'
import { META_FILE } from './path.ts'
import { MetadataSizeError } from './errors.ts'

const MAX_META_USER_BYTES = 64 * 1024
const encoder = new TextEncoder()

/** Default metadata for a new directory. */
export function defaultDirMeta(): DirMeta {
  return {
    permissions: { read: true, write: true },
    children: {},
  }
}

/**
 * Read and parse the `.meta` file from an OPFS directory handle.
 * Returns default meta if the file doesn't exist.
 */
export async function readMeta(dirHandle: FileSystemDirectoryHandle): Promise<DirMeta> {
  try {
    const fileHandle = await dirHandle.getFileHandle(META_FILE)
    const file = await fileHandle.getFile()
    const text = await file.text()
    return JSON.parse(text) as DirMeta
  } catch {
    return defaultDirMeta()
  }
}

/**
 * Serialize and write a `.meta` file to an OPFS directory handle.
 */
export async function writeMeta(dirHandle: FileSystemDirectoryHandle, meta: DirMeta): Promise<void> {
  const json = JSON.stringify(meta)
  const fileHandle = await dirHandle.getFileHandle(META_FILE, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(json)
  await writable.close()
}

/**
 * Validate that user metadata for a single entry doesn't exceed 64KB.
 * Throws MetadataSizeError if too large.
 */
export function validateMetaSize(path: string, meta: Record<string, unknown>): void {
  const bytes = encoder.encode(JSON.stringify(meta)).byteLength
  if (bytes > MAX_META_USER_BYTES) {
    throw new MetadataSizeError(path)
  }
}

/**
 * Acquire a navigator.locks lock scoped to a directory path, then run `fn`.
 * Serializes `.meta` writes per directory.
 */
export async function withMetaLock<T>(dirPath: string, fn: () => Promise<T>): Promise<T> {
  const lockName = `opfs-ext:meta:${dirPath}`
  return navigator.locks.request(lockName, () => fn())
}

/**
 * Apply a usage delta to the cached stats in root `.meta`.
 * Runs under the meta lock for '/'.
 */
export async function updateUsage(
  rootDirHandle: FileSystemDirectoryHandle,
  delta: Partial<UsageStats>,
): Promise<void> {
  await withMetaLock('/', async () => {
    const meta = await readMeta(rootDirHandle)
    if (!meta.usage) return
    meta.usage.totalSize = Math.max(0, meta.usage.totalSize + (delta.totalSize ?? 0))
    meta.usage.fileCount = Math.max(0, meta.usage.fileCount + (delta.fileCount ?? 0))
    meta.usage.directoryCount = Math.max(0, meta.usage.directoryCount + (delta.directoryCount ?? 0))
    await writeMeta(rootDirHandle, meta)
  })
}

export { encoder }
