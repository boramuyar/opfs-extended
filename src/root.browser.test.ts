import { describe, it, expect, afterEach } from 'vitest'
import { createRoot, createRootFromHandle, Root } from './root.ts'

const cleanupRoots: Root[] = []

function uniqueRoot() {
  return `test-root-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

afterEach(async () => {
  for (const r of cleanupRoots) {
    try { await r.destroy() } catch { /* already destroyed */ }
  }
  cleanupRoots.length = 0
})

describe('createRoot', () => {
  it('creates a root and returns mount', async () => {
    const root = await createRoot(uniqueRoot())
    cleanupRoots.push(root)
    const fs = root.mount()
    await fs.writeFile('/test.txt', 'works')
    expect(await fs.readTextFile('/test.txt')).toBe('works')
  })

  it('returns singleton for same path', async () => {
    const path = uniqueRoot()
    const r1 = await createRoot(path)
    cleanupRoots.push(r1)
    const r2 = await createRoot(path)
    expect(r1).toBe(r2)
  })
})

describe('createRootFromHandle', () => {
  it('creates root from external handle', async () => {
    const opfsRoot = await navigator.storage.getDirectory()
    const key = uniqueRoot()
    const dirHandle = await opfsRoot.getDirectoryHandle(key, { create: true })
    const root = await createRootFromHandle(key, dirHandle)
    cleanupRoots.push(root)

    const fs = root.mount()
    await fs.writeFile('/ext.txt', 'external')
    expect(await fs.readTextFile('/ext.txt')).toBe('external')
  })
})

describe('mount scoping', () => {
  it('scopes mount to subpath', async () => {
    const root = await createRoot(uniqueRoot())
    cleanupRoots.push(root)
    const rootFs = root.mount()
    await rootFs.mkdir('/sub')

    const subFs = root.mount('sub')
    await subFs.writeFile('/file.txt', 'scoped')

    // Accessible from root at /sub/file.txt
    expect(await rootFs.readTextFile('/sub/file.txt')).toBe('scoped')
    // Accessible from sub-mount at /file.txt
    expect(await subFs.readTextFile('/file.txt')).toBe('scoped')
  })
})

describe('destroy', () => {
  it('cleans up root directory', async () => {
    const path = uniqueRoot()
    const root = await createRoot(path)
    const fs = root.mount()
    await fs.writeFile('/gone.txt', 'bye')
    await root.destroy()

    // Creating a new root at same path should start fresh
    const root2 = await createRoot(path)
    cleanupRoots.push(root2)
    const fs2 = root2.mount()
    expect(await fs2.exists('/gone.txt')).toBe(false)
  })
})

describe('usage', () => {
  it('reports file count and size', async () => {
    const root = await createRoot(uniqueRoot())
    cleanupRoots.push(root)
    const fs = root.mount()
    await fs.writeFile('/a.txt', 'aaaa')
    await fs.writeFile('/b.txt', 'bb')
    await fs.mkdir('/d')
    await fs.writeFile('/d/c.txt', 'c')

    const usage = await root.usage()
    expect(usage.fileCount).toBe(3)
    expect(usage.directoryCount).toBe(1)
    expect(usage.totalSize).toBeGreaterThanOrEqual(7)
  })

  it('tracks usage incrementally after writes and removes', async () => {
    const root = await createRoot(uniqueRoot())
    cleanupRoots.push(root)
    const fs = root.mount()

    await fs.writeFile('/x.txt', 'hello') // 5 bytes
    let usage = await root.usage()
    expect(usage.fileCount).toBe(1)
    expect(usage.totalSize).toBe(5)

    await fs.writeFile('/y.txt', 'world!') // 6 bytes
    usage = await root.usage()
    expect(usage.fileCount).toBe(2)
    expect(usage.totalSize).toBe(11)

    await fs.remove('/x.txt')
    usage = await root.usage()
    expect(usage.fileCount).toBe(1)
    expect(usage.totalSize).toBe(6)
  })

  it('full walk recalculates and matches incremental', async () => {
    const root = await createRoot(uniqueRoot())
    cleanupRoots.push(root)
    const fs = root.mount()
    await fs.writeFile('/a.txt', 'aaa')
    await fs.mkdir('/sub')
    await fs.writeFile('/sub/b.txt', 'bb')

    const cached = await root.usage()
    const full = await root.usage({ full: true })
    expect(full.fileCount).toBe(cached.fileCount)
    expect(full.directoryCount).toBe(cached.directoryCount)
    expect(full.totalSize).toBe(cached.totalSize)
  })

  it('fsck rebuilds accurate usage stats', async () => {
    const root = await createRoot(uniqueRoot())
    cleanupRoots.push(root)
    const fs = root.mount()
    await fs.writeFile('/a.txt', 'abc')
    await fs.mkdir('/d')
    await fs.writeFile('/d/b.txt', 'de')

    await root.fsck()
    const usage = await root.usage()
    expect(usage.fileCount).toBe(2)
    expect(usage.directoryCount).toBe(1)
    expect(usage.totalSize).toBe(5)
  })
})
