// Factory
export { createRoot, createRootFromHandle } from './root.ts'

// Classes (for instanceof checks)
export { Root } from './root.ts'
export { Mount } from './mount.ts'
export { TrackedWritableStream } from './stream.ts'

// Errors
export {
  FSError,
  NotFoundError,
  ExistsError,
  PermissionError,
  MetadataSizeError,
} from './errors.ts'

// Path utilities
export {
  normalizePath,
  resolvePath,
  parentPath,
  basename,
  joinPath,
  isMetaFile,
} from './path.ts'

// Types
export type {
  IRoot,
  IFS,
  FileEntry,
  FileStat,
  Permissions,
  WatchEvent,
  UsageStats,
  WriteOptions,
  MkdirOptions,
  DirMeta,
  ChildMeta,
  Unsubscribe,
  WriteStreamOptions,
  FsckResult,
  CreateRootOptions,
} from './types.ts'
