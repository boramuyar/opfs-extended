import { createRootFromHandle } from './root.ts'

interface WorkerMessage {
  rootPath: string
  filePath: string
  content: string
}

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const { rootPath, filePath, content } = e.data
  try {
    const opfsRoot = await navigator.storage.getDirectory()
    const handle = await opfsRoot.getDirectoryHandle(rootPath)
    const root = await createRootFromHandle(rootPath, handle)
    const fs = root.mount()
    await fs.writeFile(filePath, content)
    // Don't destroy — let the main thread own cleanup
    self.postMessage({ ok: true })
  } catch (err) {
    self.postMessage({ ok: false, error: String(err) })
  }
}
