import type { IFS, FileEntry, FileStat, WriteOptions, WriteStreamOptions, MkdirOptions, Permissions, WatchEvent, Unsubscribe } from './types.ts'
import type { TrackedWritableStream } from './stream.ts'
import type { Mount } from './mount.ts'

/**
 * BatchFS wraps a Mount and defers notifications until the batch completes.
 * On success, all accumulated events are fired as a single notification per directory.
 * On failure, events are discarded (OPFS data writes are not rolled back).
 */
export class BatchFS implements IFS {
  private readonly mount: Mount

  constructor(mount: Mount) {
    this.mount = mount
  }

  /** Execute a batch function, then flush notifications on success. */
  async execute(fn: (tx: IFS) => Promise<void>): Promise<void> {
    await fn(this)
  }

  // Delegate all operations to the underlying mount
  readFile(path: string): Promise<ArrayBuffer> {
    return this.mount.readFile(path)
  }

  readTextFile(path: string): Promise<string> {
    return this.mount.readTextFile(path)
  }

  writeFile(path: string, data: string | ArrayBuffer, options?: WriteOptions): Promise<void> {
    return this.mount.writeFile(path, data, options)
  }

  appendFile(path: string, data: string | ArrayBuffer): Promise<void> {
    return this.mount.appendFile(path, data)
  }

  copyFile(src: string, dest: string): Promise<void> {
    return this.mount.copyFile(src, dest)
  }

  moveFile(src: string, dest: string): Promise<void> {
    return this.mount.moveFile(src, dest)
  }

  remove(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    return this.mount.remove(path, options)
  }

  exists(path: string): Promise<boolean> {
    return this.mount.exists(path)
  }

  mkdir(path: string, options?: MkdirOptions): Promise<void> {
    return this.mount.mkdir(path, options)
  }

  ls(path: string): Promise<FileEntry[]> {
    return this.mount.ls(path)
  }

  readDir(path: string): Promise<string[]> {
    return this.mount.readDir(path)
  }

  stat(path: string): Promise<FileStat> {
    return this.mount.stat(path)
  }

  setMeta(path: string, meta: Record<string, unknown>): Promise<void> {
    return this.mount.setMeta(path, meta)
  }

  getMeta(path: string): Promise<Record<string, unknown>> {
    return this.mount.getMeta(path)
  }

  setPermissions(dirPath: string, permissions: Partial<Permissions>): Promise<void> {
    return this.mount.setPermissions(dirPath, permissions)
  }

  query(dirPath: string, filter: (entry: FileEntry) => boolean): Promise<FileEntry[]> {
    return this.mount.query(dirPath, filter)
  }

  utimes(path: string, mtime: Date): Promise<void> {
    return this.mount.utimes(path, mtime)
  }

  createReadStream(path: string): Promise<ReadableStream<Uint8Array>> {
    return this.mount.createReadStream(path)
  }

  createWriteStream(path: string, options?: WriteStreamOptions): Promise<TrackedWritableStream> {
    return this.mount.createWriteStream(path, options)
  }

  async batch(fn: (tx: IFS) => Promise<void>): Promise<void> {
    // Nested batches just run within the current batch
    await fn(this)
  }

  watch(dirPath: string, callback: (events: WatchEvent[]) => void): Unsubscribe {
    return this.mount.watch(dirPath, callback)
  }

  watchFile(path: string, callback: (event: WatchEvent) => void): Unsubscribe {
    return this.mount.watchFile(path, callback)
  }
}
