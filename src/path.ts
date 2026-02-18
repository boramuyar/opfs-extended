const META_FILENAME = '.meta'

/**
 * Normalize a path: resolve `.` and `..`, ensure leading `/`, strip trailing `/`.
 * Empty or root input returns `/`.
 */
export function normalizePath(path: string): string {
  const segments = path.split('/').filter(Boolean)
  const resolved: string[] = []

  for (const seg of segments) {
    if (seg === '.') continue
    if (seg === '..') {
      resolved.pop()
    } else {
      resolved.push(seg)
    }
  }

  return '/' + resolved.join('/')
}

/**
 * Resolve a user-provided path relative to a mount base.
 * `..` is clamped at the mount root — it cannot escape.
 * Returns an absolute OPFS-relative path.
 */
export function resolvePath(mountBase: string, userPath: string): string {
  const normalizedBase = normalizePath(mountBase)

  // Treat absolute paths as relative to mount root
  const combined = userPath.startsWith('/')
    ? normalizedBase + userPath
    : normalizedBase + '/' + userPath

  const baseSegments = normalizedBase.split('/').filter(Boolean)
  const allSegments = combined.split('/').filter(Boolean)
  const resolved: string[] = []

  for (const seg of allSegments) {
    if (seg === '.') continue
    if (seg === '..') {
      // Don't pop below mount base
      if (resolved.length > baseSegments.length) {
        resolved.pop()
      }
    } else {
      resolved.push(seg)
    }
  }

  return '/' + resolved.join('/')
}

/** Get the parent directory path. Returns `/` for root-level paths. */
export function parentPath(path: string): string {
  const normalized = normalizePath(path)
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash <= 0) return '/'
  return normalized.slice(0, lastSlash)
}

/** Get the last segment of a path (filename or directory name). */
export function basename(path: string): string {
  const normalized = normalizePath(path)
  const lastSlash = normalized.lastIndexOf('/')
  return normalized.slice(lastSlash + 1)
}

/** Join path parts into a normalized path. */
export function joinPath(...parts: string[]): string {
  return normalizePath(parts.join('/'))
}

/** Returns true if the name is the reserved `.meta` filename. */
export function isMetaFile(name: string): boolean {
  return name === META_FILENAME
}

/** The reserved meta filename constant. */
export const META_FILE = META_FILENAME
