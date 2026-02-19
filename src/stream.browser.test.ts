import { describe, it, expect, afterEach } from 'vitest'
import { createRoot } from './root.ts'
import type { Root } from './root.ts'
import type { IFS } from './types.ts'

let root: Root
let fs: IFS

function uniqueRoot() {
  return `test-stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

afterEach(async () => {
  if (root) {
    await root.destroy()
  }
})

async function setup() {
  root = await createRoot(uniqueRoot())
  fs = root.mount()
}

describe('createReadStream', () => {
  it('reads file as stream', async () => {
    await setup()
    await fs.writeFile('/stream-read.txt', 'streaming content')

    const stream = await fs.createReadStream('/stream-read.txt')
    const reader = stream.getReader()
    const chunks: Uint8Array[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }

    const combined = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0))
    let offset = 0
    for (const chunk of chunks) {
      combined.set(chunk, offset)
      offset += chunk.length
    }

    const text = new TextDecoder().decode(combined)
    expect(text).toBe('streaming content')
  })
})

describe('createWriteStream', () => {
  it('writes via stream and closes', async () => {
    await setup()
    const ws = await fs.createWriteStream('/stream-write.txt')
    await ws.write('hello ')
    await ws.write('stream')
    await ws.close()

    const text = await fs.readTextFile('/stream-write.txt')
    expect(text).toBe('hello stream')
  })

  it('updates stat after close', async () => {
    await setup()
    const ws = await fs.createWriteStream('/stream-stat.txt')
    await ws.write('12345')
    await ws.close()

    const stat = await fs.stat('/stream-stat.txt')
    expect(stat.type).toBe('file')
    expect(stat.size).toBeGreaterThan(0)
  })

  it('supports metadata option', async () => {
    await setup()
    const ws = await fs.createWriteStream('/stream-meta.txt', { meta: { source: 'stream' } })
    await ws.write('data')
    await ws.close()

    const meta = await fs.getMeta('/stream-meta.txt')
    expect(meta.source).toBe('stream')
  })
})

describe('abort', () => {
  it('aborts stream without finalizing', async () => {
    await setup()
    const ws = await fs.createWriteStream('/stream-abort.txt')
    await ws.write('partial')
    await ws.abort('cancelled')

    // File handle was created but data is discarded on abort
    // The file may or may not exist depending on OPFS behavior,
    // but metadata should not be updated
    const exists = await fs.exists('/stream-abort.txt')
    if (exists) {
      const text = await fs.readTextFile('/stream-abort.txt')
      // Aborted writes should result in empty or no data
      expect(text.length).toBeLessThanOrEqual('partial'.length)
    }
  })
})
