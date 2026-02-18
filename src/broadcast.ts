import type { WatchEvent } from './types.ts'

interface BroadcastMessage {
  rootPath: string
  dirPath: string
  events: WatchEvent[]
}

interface Broadcast {
  /** Notify other workers/tabs about changes in a directory. */
  notify(dirPath: string, events: WatchEvent[]): void
  /** Subscribe to changes from other workers/tabs. Returns unsubscribe fn. */
  subscribe(callback: (dirPath: string, events: WatchEvent[]) => void): () => void
  /** Tear down the channel. */
  destroy(): void
}

const CHANNEL_NAME = 'opfs-ext'

/** Create a BroadcastChannel wrapper scoped to a root path. */
export function createBroadcast(rootPath: string): Broadcast {
  const channel = new BroadcastChannel(CHANNEL_NAME)
  const listeners = new Set<(dirPath: string, events: WatchEvent[]) => void>()

  channel.onmessage = (event: MessageEvent<BroadcastMessage>) => {
    const data = event.data
    if (data.rootPath !== rootPath) return
    for (const listener of listeners) {
      listener(data.dirPath, data.events)
    }
  }

  return {
    notify(dirPath, events) {
      const message: BroadcastMessage = { rootPath, dirPath, events }
      channel.postMessage(message)
    },

    subscribe(callback) {
      listeners.add(callback)
      return () => { listeners.delete(callback) }
    },

    destroy() {
      listeners.clear()
      channel.close()
    },
  }
}
