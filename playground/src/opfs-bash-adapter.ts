/**
 * Adapts opfs-extended's IFS into just-bash's IFileSystem interface.
 *
 * Unlike the coherent-assistant version, there's no mount system here -
 * IFS paths map 1:1 to bash paths.
 */

import type { FsStat, IFileSystem } from 'just-bash/browser'
import type { IFS } from 'opfs-extended'

interface DirentEntry {
  name: string
  isFile: boolean
  isDirectory: boolean
  isSymbolicLink: boolean
}

const DEFAULT_MODE_FILE = 0o644
const DEFAULT_MODE_DIR = 0o755

export class OpfsBashAdapter implements IFileSystem {
  private readonly fs: IFS
  private pathCache: string[] | null = null

  constructor(fs: IFS) {
    this.fs = fs
  }

  // Read operations

  async readFile(path: string): Promise<string> {
    return this.fs.readTextFile(normalizePath(path))
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    const buf = await this.fs.readFile(normalizePath(path))
    return new Uint8Array(buf)
  }

  // Write operations

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    this.invalidatePathCache()
    const data = content instanceof Uint8Array ? content.buffer as ArrayBuffer : content
    await this.fs.writeFile(normalizePath(path), data)
  }

  async appendFile(path: string, content: string | Uint8Array): Promise<void> {
    this.invalidatePathCache()
    const data = content instanceof Uint8Array ? content.buffer as ArrayBuffer : content
    await this.fs.appendFile(normalizePath(path), data)
  }

  // Metadata operations

  async exists(path: string): Promise<boolean> {
    return this.fs.exists(normalizePath(path))
  }

  async stat(path: string): Promise<FsStat> {
    const s = await this.fs.stat(normalizePath(path))
    return {
      isFile: s.type === 'file',
      isDirectory: s.type === 'directory',
      isSymbolicLink: false,
      mode: s.type === 'file' ? DEFAULT_MODE_FILE : DEFAULT_MODE_DIR,
      size: s.size,
      mtime: new Date(s.mtime),
    }
  }

  async lstat(path: string): Promise<FsStat> {
    return this.stat(path)
  }

  // Directory operations

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    this.invalidatePathCache()
    await this.fs.mkdir(normalizePath(path), options)
  }

  async readdir(path: string): Promise<string[]> {
    return this.fs.readDir(normalizePath(path))
  }

  async readdirWithFileTypes(path: string): Promise<DirentEntry[]> {
    const entries = await this.fs.ls(normalizePath(path))
    return entries.map((e) => ({
      name: e.name,
      isFile: e.type === 'file',
      isDirectory: e.type === 'directory',
      isSymbolicLink: false,
    }))
  }

  // Delete, copy, move

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    this.invalidatePathCache()
    try {
      await this.fs.remove(normalizePath(path), options)
    } catch (err) {
      if (!options?.force) throw err
    }
  }

  async cp(src: string, dest: string): Promise<void> {
    this.invalidatePathCache()
    await this.fs.copyFile(normalizePath(src), normalizePath(dest))
  }

  async mv(src: string, dest: string): Promise<void> {
    this.invalidatePathCache()
    await this.fs.moveFile(normalizePath(src), normalizePath(dest))
  }

  // No-op operations

  async chmod(): Promise<void> {}
  async utimes(): Promise<void> {}

  // Unsupported operations

  async symlink(): Promise<void> {
    throw new Error('Symlinks are not supported')
  }

  async link(): Promise<void> {
    throw new Error('Hard links are not supported')
  }

  async readlink(): Promise<string> {
    throw new Error('Symlinks are not supported')
  }

  // Path operations

  resolvePath(base: string, path: string): string {
    if (path.startsWith('/')) return normalizePath(path)

    const baseParts = base.split('/').filter(Boolean)
    const pathParts = path.split('/').filter(Boolean)

    for (const part of pathParts) {
      if (part === '..') baseParts.pop()
      else if (part !== '.') baseParts.push(part)
    }

    return `/${baseParts.join('/')}`
  }

  async realpath(path: string): Promise<string> {
    return normalizePath(path)
  }

  /** Pre-build the path cache before passing to Bash. */
  async init(): Promise<void> {
    await this.buildPathCache()
  }

  getAllPaths(): string[] {
    if (this.pathCache) return this.pathCache
    this.buildPathCache()
    return ['/']
  }

  // Internal helpers

  private invalidatePathCache(): void {
    this.pathCache = null
  }

  private async buildPathCache(): Promise<void> {
    const paths: string[] = ['/']
    await this.walkForPaths('/', paths)
    this.pathCache = paths
  }

  private async walkForPaths(dir: string, result: string[]): Promise<void> {
    try {
      const entries = await this.fs.ls(dir)
      for (const entry of entries) {
        const childPath = dir === '/' ? `/${entry.name}` : `${dir}/${entry.name}`
        result.push(childPath)
        if (entry.type === 'directory') {
          await this.walkForPaths(childPath, result)
        }
      }
    } catch {
      // Directory doesn't exist or not readable
    }
  }
}

function normalizePath(path: string): string {
  const normalized = `/${path}`.replace(/\/+/g, '/').replace(/\/+$/, '')
  return normalized || '/'
}
