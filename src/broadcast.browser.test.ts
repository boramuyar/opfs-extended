import { describe, it, expect, afterEach } from 'vitest'
import { createRoot } from './root.ts'
import type { Root } from './root.ts'
import type { WatchEvent } from './types.ts'

const cleanupRoots: Root[] = []

function uniqueRoot() {
  return `test-broadcast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

afterEach(async () => {
  for (const r of cleanupRoots) {
    try { await r.destroy() } catch { /* already destroyed */ }
  }
  cleanupRoots.length = 0
})

/**
 * Create a worker that writes a file to OPFS via the library.
 * The worker runs in a separate JS context, so BroadcastChannel
 * messages from it are received as cross-context events.
 */
function spawnWriterWorker(rootPath: string, filePath: string, content: string): Worker {
  const worker = new Worker(new URL('./test-worker.ts', import.meta.url), { type: 'module' })
  worker.postMessage({ rootPath, filePath, content })
  return worker
}

function waitForWorker(worker: Worker): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      worker.terminate()
      resolve(e.data)
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(new Error(e.message))
    }
  })
}

describe('cross-worker broadcast', () => {
  it('receives watch events from another worker via BroadcastChannel', async () => {
    const rootPath = uniqueRoot()
    const root = await createRoot(rootPath)
    cleanupRoots.push(root)
    const fs = root.mount()

    // Set up watcher on the main thread
    const received: WatchEvent[] = []
    const unsub = fs.watch('/', (events) => {
      received.push(...events)
    })

    // Spawn a worker that writes a file to the same root
    const worker = spawnWriterWorker(rootPath, '/from-worker.txt', 'hello from worker')
    const result = await waitForWorker(worker)
    expect(result.ok).toBe(true)

    // BroadcastChannel is async — give it a tick to deliver
    await new Promise((r) => setTimeout(r, 100))

    unsub()

    // The main thread should have received a create event via broadcast
    expect(received.length).toBeGreaterThanOrEqual(1)
    const createEvent = received.find(e => e.name === 'from-worker.txt')
    expect(createEvent).toBeDefined()
    expect(createEvent!.type).toBe('create')

    // Verify the file is actually in OPFS
    const text = await fs.readTextFile('/from-worker.txt')
    expect(text).toBe('hello from worker')
  })

  it('does not fire watcher for unwatched directory', async () => {
    const rootPath = uniqueRoot()
    const root = await createRoot(rootPath)
    cleanupRoots.push(root)
    const fs = root.mount()

    await fs.mkdir('/watched')
    await fs.mkdir('/other')

    const received: WatchEvent[] = []
    const unsub = fs.watch('/watched', (events) => {
      received.push(...events)
    })

    // Write to a different directory
    await fs.writeFile('/other/file.txt', 'not watched')

    await new Promise((r) => setTimeout(r, 100))
    unsub()

    expect(received.length).toBe(0)
  })
})
