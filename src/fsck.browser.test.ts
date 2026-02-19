import { describe, it, expect, afterEach } from 'vitest'
import { createRootFromHandle, Root } from './root.ts'
import { META_FILE } from './path.ts'

const cleanupRoots: Root[] = []

function uniqueRoot() {
  return `test-fsck-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

afterEach(async () => {
  for (const r of cleanupRoots) {
    try { await r.destroy() } catch { /* already destroyed */ }
  }
  cleanupRoots.length = 0
})

describe('fsck', () => {
  it('rebuilds .meta when deleted', async () => {
    const name = uniqueRoot()
    const opfsRoot = await navigator.storage.getDirectory()
    const handle = await opfsRoot.getDirectoryHandle(name, { create: true })
    const root = await createRootFromHandle(name, handle)
    cleanupRoots.push(root)
    const fs = root.mount()

    await fs.writeFile('/a.txt', 'hello')
    await fs.mkdir('/sub')
    await fs.writeFile('/sub/b.txt', 'world')

    // Delete .meta files directly via OPFS handles
    await root.dirHandle.removeEntry(META_FILE)
    const subHandle = await root.dirHandle.getDirectoryHandle('sub')
    await subHandle.removeEntry(META_FILE)

    const result = await root.fsck()
    expect(result.repaired).toBeGreaterThanOrEqual(2)
    expect(result.entries).toBeGreaterThanOrEqual(3)

    // ls should work after repair
    const entries = await fs.ls('/')
    const names = entries.map(e => e.name).sort()
    expect(names).toContain('a.txt')
    expect(names).toContain('sub')

    const subEntries = await fs.ls('/sub')
    expect(subEntries.map(e => e.name)).toContain('b.txt')
  })

  it('removes orphaned .meta entries for deleted files', async () => {
    const name = uniqueRoot()
    const opfsRoot = await navigator.storage.getDirectory()
    const handle = await opfsRoot.getDirectoryHandle(name, { create: true })
    const root = await createRootFromHandle(name, handle)
    cleanupRoots.push(root)
    const fs = root.mount()

    await fs.writeFile('/keep.txt', 'stay')
    await fs.writeFile('/gone.txt', 'bye')

    // Remove file directly via OPFS (bypassing fs.remove)
    await root.dirHandle.removeEntry('gone.txt')

    const result = await root.fsck()
    expect(result.repaired).toBe(1)

    const entries = await fs.ls('/')
    const names = entries.map(e => e.name)
    expect(names).toContain('keep.txt')
    expect(names).not.toContain('gone.txt')
  })

  it('returns repaired: 0 on healthy tree', async () => {
    const name = uniqueRoot()
    const opfsRoot = await navigator.storage.getDirectory()
    const handle = await opfsRoot.getDirectoryHandle(name, { create: true })
    const root = await createRootFromHandle(name, handle)
    cleanupRoots.push(root)
    const fs = root.mount()

    await fs.writeFile('/ok.txt', 'fine')
    await fs.mkdir('/dir')
    await fs.writeFile('/dir/nested.txt', 'also fine')

    const result = await root.fsck()
    expect(result.repaired).toBe(0)
    expect(result.entries).toBe(3)
  })

  it('updates file size when it differs', async () => {
    const name = uniqueRoot()
    const opfsRoot = await navigator.storage.getDirectory()
    const handle = await opfsRoot.getDirectoryHandle(name, { create: true })
    const root = await createRootFromHandle(name, handle)
    cleanupRoots.push(root)
    const fs = root.mount()

    await fs.writeFile('/size.txt', 'short')

    // Overwrite directly via OPFS to change size without updating .meta
    const fileHandle = await root.dirHandle.getFileHandle('size.txt')
    const writable = await fileHandle.createWritable()
    await writable.write('much longer content here')
    await writable.close()

    const result = await root.fsck()
    expect(result.repaired).toBe(1)

    const stat = await fs.stat('/size.txt')
    expect(stat.size).toBe(24)
  })

  it('autoRepair runs fsck on createRootFromHandle', async () => {
    const name = uniqueRoot()

    // Manually set up an OPFS directory with a file but no .meta
    const opfsRoot = await navigator.storage.getDirectory()
    const dirHandle = await opfsRoot.getDirectoryHandle(name, { create: true })
    const fileHandle = await dirHandle.getFileHandle('auto.txt', { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write('test')
    await writable.close()

    // createRootFromHandle with autoRepair should detect the file and build .meta
    const root = await createRootFromHandle(name, dirHandle, { autoRepair: true })
    cleanupRoots.push(root)

    const fs = root.mount()
    const entries = await fs.ls('/')
    expect(entries.map(e => e.name)).toContain('auto.txt')
  })
})
