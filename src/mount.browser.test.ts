import { describe, it, expect, afterEach } from 'vitest'
import { createRootFromHandle } from './root.ts'
import type { Root } from './root.ts'
import type { IFS, WatchEvent } from './types.ts'
import { NotFoundError, ExistsError, PermissionError } from './errors.ts'

let root: Root
let fs: IFS

function uniqueRoot() {
  return `test-mount-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

afterEach(async () => {
  if (root) {
    await root.destroy()
  }
})

async function setup() {
  const name = uniqueRoot()
  const opfsRoot = await navigator.storage.getDirectory()
  const handle = await opfsRoot.getDirectoryHandle(name, { create: true })
  root = await createRootFromHandle(name, handle)
  fs = root.mount()
}

describe('writeFile / readFile / readTextFile', () => {
  it('writes and reads text', async () => {
    await setup()
    await fs.writeFile('/hello.txt', 'hello world')
    const text = await fs.readTextFile('/hello.txt')
    expect(text).toBe('hello world')
  })

  it('writes and reads binary', async () => {
    await setup()
    const buf = new Uint8Array([1, 2, 3, 4]).buffer
    await fs.writeFile('/bin.dat', buf)
    const result = await fs.readFile('/bin.dat')
    expect(new Uint8Array(result)).toEqual(new Uint8Array([1, 2, 3, 4]))
  })

  it('overwrites existing file', async () => {
    await setup()
    await fs.writeFile('/f.txt', 'first')
    await fs.writeFile('/f.txt', 'second')
    expect(await fs.readTextFile('/f.txt')).toBe('second')
  })

  it('throws NotFoundError for missing file', async () => {
    await setup()
    await expect(fs.readFile('/nope.txt')).rejects.toThrow(NotFoundError)
  })

  it('writes file with metadata', async () => {
    await setup()
    await fs.writeFile('/tagged.txt', 'data', { meta: { tag: 'important' } })
    const meta = await fs.getMeta('/tagged.txt')
    expect(meta.tag).toBe('important')
  })
})

describe('appendFile', () => {
  it('appends to existing file', async () => {
    await setup()
    await fs.writeFile('/log.txt', 'line1\n')
    await fs.appendFile('/log.txt', 'line2\n')
    expect(await fs.readTextFile('/log.txt')).toBe('line1\nline2\n')
  })
})

describe('copyFile / moveFile', () => {
  it('copies a file', async () => {
    await setup()
    await fs.writeFile('/src.txt', 'content', { meta: { a: 1 } })
    await fs.copyFile('/src.txt', '/dst.txt')
    expect(await fs.readTextFile('/dst.txt')).toBe('content')
    const meta = await fs.getMeta('/dst.txt')
    expect(meta.a).toBe(1)
  })

  it('moves a file', async () => {
    await setup()
    await fs.writeFile('/old.txt', 'data')
    await fs.moveFile('/old.txt', '/new.txt')
    expect(await fs.readTextFile('/new.txt')).toBe('data')
    await expect(fs.readFile('/old.txt')).rejects.toThrow(NotFoundError)
  })
})

describe('remove', () => {
  it('removes a file', async () => {
    await setup()
    await fs.writeFile('/del.txt', 'x')
    await fs.remove('/del.txt')
    expect(await fs.exists('/del.txt')).toBe(false)
  })

  it('removes a directory recursively', async () => {
    await setup()
    await fs.mkdir('/dir')
    await fs.writeFile('/dir/f.txt', 'x')
    await fs.remove('/dir', { recursive: true })
    expect(await fs.exists('/dir')).toBe(false)
  })

  it('throws NotFoundError for missing entry', async () => {
    await setup()
    await expect(fs.remove('/ghost.txt')).rejects.toThrow(NotFoundError)
  })

  it('force remove ignores missing entry', async () => {
    await setup()
    await fs.remove('/ghost.txt', { force: true })
  })
})

describe('exists', () => {
  it('returns false for non-existent path', async () => {
    await setup()
    expect(await fs.exists('/nope')).toBe(false)
  })

  it('returns true for file', async () => {
    await setup()
    await fs.writeFile('/e.txt', 'x')
    expect(await fs.exists('/e.txt')).toBe(true)
  })

  it('returns true for directory', async () => {
    await setup()
    await fs.mkdir('/adir')
    expect(await fs.exists('/adir')).toBe(true)
  })
})

describe('mkdir', () => {
  it('creates a directory', async () => {
    await setup()
    await fs.mkdir('/mydir')
    expect(await fs.exists('/mydir')).toBe(true)
  })

  it('throws ExistsError for duplicate', async () => {
    await setup()
    await fs.mkdir('/dup')
    await expect(fs.mkdir('/dup')).rejects.toThrow(ExistsError)
  })

  it('creates nested directories with recursive option', async () => {
    await setup()
    // Parent of target must exist for write permission check
    await fs.mkdir('/a')
    await fs.mkdir('/a/b', { recursive: true })
    expect(await fs.exists('/a/b')).toBe(true)
    // Also verify deeper nesting once parent chain exists
    await fs.mkdir('/a/b/c', { recursive: true })
    expect(await fs.exists('/a/b/c')).toBe(true)
  })

  it('creates directory with custom permissions', async () => {
    await setup()
    await fs.mkdir('/locked', { permissions: { write: false } })
    await expect(fs.writeFile('/locked/f.txt', 'x')).rejects.toThrow(PermissionError)
  })
})

describe('ls / readDir', () => {
  it('lists files and directories', async () => {
    await setup()
    await fs.writeFile('/a.txt', 'a')
    await fs.mkdir('/sub')
    const entries = await fs.ls('/')
    const names = entries.map(e => e.name).sort()
    expect(names).toContain('a.txt')
    expect(names).toContain('sub')
  })

  it('readDir returns names only', async () => {
    await setup()
    await fs.writeFile('/x.txt', 'x')
    const names = await fs.readDir('/')
    expect(names).toContain('x.txt')
  })
})

describe('stat', () => {
  it('returns file stat', async () => {
    await setup()
    await fs.writeFile('/s.txt', 'hello')
    const s = await fs.stat('/s.txt')
    expect(s.type).toBe('file')
    expect(s.size).toBe(5)
    expect(s.name).toBe('s.txt')
    expect(s.path).toBe('/s.txt')
  })

  it('returns directory stat', async () => {
    await setup()
    await fs.mkdir('/sdir')
    const s = await fs.stat('/sdir')
    expect(s.type).toBe('directory')
  })

  it('throws NotFoundError for missing', async () => {
    await setup()
    await expect(fs.stat('/missing')).rejects.toThrow(NotFoundError)
  })
})

describe('setMeta / getMeta', () => {
  it('sets and gets metadata', async () => {
    await setup()
    await fs.writeFile('/m.txt', 'x')
    await fs.setMeta('/m.txt', { key: 'value', num: 42 })
    const meta = await fs.getMeta('/m.txt')
    expect(meta.key).toBe('value')
    expect(meta.num).toBe(42)
  })

  it('merges metadata', async () => {
    await setup()
    await fs.writeFile('/m2.txt', 'x')
    await fs.setMeta('/m2.txt', { a: 1 })
    await fs.setMeta('/m2.txt', { b: 2 })
    const meta = await fs.getMeta('/m2.txt')
    expect(meta.a).toBe(1)
    expect(meta.b).toBe(2)
  })
})

describe('setPermissions', () => {
  it('blocks reads on read:false directory', async () => {
    await setup()
    await fs.mkdir('/noread')
    await fs.writeFile('/noread/f.txt', 'secret')
    await fs.setPermissions('/noread', { read: false })
    await expect(fs.readFile('/noread/f.txt')).rejects.toThrow(PermissionError)
  })

  it('blocks writes on write:false directory', async () => {
    await setup()
    await fs.mkdir('/nowrite')
    await fs.setPermissions('/nowrite', { write: false })
    await expect(fs.writeFile('/nowrite/f.txt', 'x')).rejects.toThrow(PermissionError)
  })
})

describe('query', () => {
  it('filters entries by predicate', async () => {
    await setup()
    await fs.writeFile('/q1.txt', 'small')
    await fs.writeFile('/q2.dat', 'also small')
    const results = await fs.query('/', e => e.name.endsWith('.txt'))
    expect(results.length).toBe(1)
    expect(results[0].name).toBe('q1.txt')
  })
})

describe('utimes', () => {
  it('updates mtime', async () => {
    await setup()
    await fs.writeFile('/t.txt', 'x')
    const target = new Date('2020-01-01T00:00:00Z')
    await fs.utimes('/t.txt', target)
    const s = await fs.stat('/t.txt')
    expect(s.mtime).toBe(target.getTime())
  })
})

describe('watch / watchFile', () => {
  it('watch fires on file create', async () => {
    await setup()
    const events: WatchEvent[] = []
    const unsub = fs.watch('/', ev => events.push(...ev))
    await fs.writeFile('/watched.txt', 'x')
    unsub()
    expect(events.length).toBeGreaterThanOrEqual(1)
    expect(events[0].type).toBe('create')
    expect(events[0].name).toBe('watched.txt')
  })

  it('watchFile fires for specific file', async () => {
    await setup()
    await fs.writeFile('/target.txt', 'v1')
    const events: WatchEvent[] = []
    const unsub = fs.watchFile('/target.txt', ev => events.push(ev))
    await fs.writeFile('/target.txt', 'v2')
    unsub()
    expect(events.length).toBeGreaterThanOrEqual(1)
    expect(events[0].type).toBe('update')
  })

  it('watchFile ignores other files', async () => {
    await setup()
    await fs.writeFile('/target2.txt', 'v1')
    const events: WatchEvent[] = []
    const unsub = fs.watchFile('/target2.txt', ev => events.push(ev))
    await fs.writeFile('/other.txt', 'x')
    unsub()
    expect(events.length).toBe(0)
  })
})
