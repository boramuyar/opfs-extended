/** Callback unsubscriber returned by watch/watchFile. */
export type Unsubscribe = () => void

/** Options for writeFile. */
export interface WriteOptions {
  meta?: Record<string, unknown>
}

/** Options for mkdir. */
export interface MkdirOptions {
  recursive?: boolean
  permissions?: { read?: boolean; write?: boolean }
}

/** Directory-level permissions. */
export interface Permissions {
  read: boolean
  write: boolean
}

/** A file or directory entry returned by ls/query. */
export interface FileEntry {
  name: string
  type: 'file' | 'directory'
  size: number
  ctime: number
  mtime: number
  meta: Record<string, unknown>
}

/** Extended entry with absolute path, returned by stat. */
export interface FileStat extends FileEntry {
  path: string
}

/** Event fired by watch/watchFile. */
export interface WatchEvent {
  type: 'create' | 'update' | 'delete'
  entry: FileEntry
  /** The entry name (filename or directory name) */
  name: string
  /** The full path of the affected entry */
  path: string
}

/** Aggregate storage statistics. */
export interface UsageStats {
  totalSize: number
  fileCount: number
  directoryCount: number
}

/** Per-directory `.meta` file shape. */
export interface DirMeta {
  permissions: Permissions
  children: Record<string, ChildMeta>
}

/** Metadata stored per child entry in a `.meta` file. */
export interface ChildMeta {
  type: 'file' | 'directory'
  size?: number
  ctime: number
  mtime: number
  meta: Record<string, unknown>
}

/** Options for createWriteStream. */
export interface WriteStreamOptions {
  meta?: Record<string, unknown>
}

/** The filesystem interface exposed by a mount. */
export interface IFS {
  readFile(path: string): Promise<ArrayBuffer>
  readTextFile(path: string): Promise<string>
  writeFile(path: string, data: string | ArrayBuffer, options?: WriteOptions): Promise<void>
  appendFile(path: string, data: string | ArrayBuffer): Promise<void>
  copyFile(src: string, dest: string): Promise<void>
  moveFile(src: string, dest: string): Promise<void>
  remove(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
  exists(path: string): Promise<boolean>
  mkdir(path: string, options?: MkdirOptions): Promise<void>
  ls(path: string): Promise<FileEntry[]>
  readDir(path: string): Promise<string[]>
  stat(path: string): Promise<FileStat>
  setMeta(path: string, meta: Record<string, unknown>): Promise<void>
  getMeta(path: string): Promise<Record<string, unknown>>
  setPermissions(dirPath: string, permissions: Partial<Permissions>): Promise<void>
  query(dirPath: string, filter: (entry: FileEntry) => boolean): Promise<FileEntry[]>
  utimes(path: string, mtime: Date): Promise<void>
  createReadStream(path: string): Promise<ReadableStream<Uint8Array>>
  createWriteStream(path: string, options?: WriteStreamOptions): Promise<import('./stream.ts').TrackedWritableStream>
  batch(fn: (tx: IFS) => Promise<void>): Promise<void>
  watch(dirPath: string, callback: (events: WatchEvent[]) => void): Unsubscribe
  watchFile(path: string, callback: (event: WatchEvent) => void): Unsubscribe
}

/** A root manages a top-level OPFS directory and its mounts. */
export interface IRoot {
  mount(subpath?: string): IFS
  destroy(): Promise<void>
  usage(): Promise<UsageStats>
}
