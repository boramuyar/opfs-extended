import { describe, it, expect, afterEach } from 'vitest'
import { createRoot } from './root.ts'
import type { Root } from './root.ts'
import type { IFS } from './types.ts'

let root: Root
let fs: IFS

function uniqueRoot() {
  return `test-batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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

describe('batch', () => {
  it('executes multiple operations in a batch', async () => {
    await setup()
    await fs.batch(async (tx) => {
      await tx.writeFile('/b1.txt', 'one')
      await tx.writeFile('/b2.txt', 'two')
      await tx.mkdir('/bdir')
    })

    expect(await fs.readTextFile('/b1.txt')).toBe('one')
    expect(await fs.readTextFile('/b2.txt')).toBe('two')
    expect(await fs.exists('/bdir')).toBe(true)
  })

  it('supports nested batches', async () => {
    await setup()
    await fs.batch(async (tx) => {
      await tx.writeFile('/outer.txt', 'outer')
      await tx.batch(async (inner) => {
        await inner.writeFile('/inner.txt', 'inner')
      })
    })

    expect(await fs.readTextFile('/outer.txt')).toBe('outer')
    expect(await fs.readTextFile('/inner.txt')).toBe('inner')
  })

  it('batch operations are readable within the batch', async () => {
    await setup()
    await fs.batch(async (tx) => {
      await tx.writeFile('/readable.txt', 'hello')
      const text = await tx.readTextFile('/readable.txt')
      expect(text).toBe('hello')
    })
  })
})
