import { useState, useEffect } from 'react'

const CHANNEL_NAME = 'opfs-playground-tabs'
const HEARTBEAT_MS = 2000
const STALE_MS = 4000

/**
 * Tracks how many browser tabs have the playground open using BroadcastChannel.
 * Each tab sends heartbeats; stale tabs are pruned automatically.
 */
export function useTabCount(): number {
  const [count, setCount] = useState(1)

  useEffect(() => {
    const tabId = crypto.randomUUID()
    const peers = new Map<string, number>()
    const channel = new BroadcastChannel(CHANNEL_NAME)

    const updateCount = () => setCount(peers.size + 1)

    channel.onmessage = (e: MessageEvent<{ type: string; id: string }>) => {
      if (e.data.type === 'heartbeat') {
        peers.set(e.data.id, Date.now())
        updateCount()
      } else if (e.data.type === 'close') {
        peers.delete(e.data.id)
        updateCount()
      }
    }

    const heartbeat = setInterval(() => {
      channel.postMessage({ type: 'heartbeat', id: tabId })
      // Prune stale peers
      const now = Date.now()
      for (const [id, ts] of peers) {
        if (now - ts > STALE_MS) peers.delete(id)
      }
      updateCount()
    }, HEARTBEAT_MS)

    // Initial announce
    channel.postMessage({ type: 'heartbeat', id: tabId })

    return () => {
      clearInterval(heartbeat)
      channel.postMessage({ type: 'close', id: tabId })
      channel.close()
    }
  }, [])

  return count
}
