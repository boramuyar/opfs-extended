# opfs-extended

A typed filesystem layer over the browser's [Origin Private File System](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system) (OPFS), built primarily for client-side agentic workflows. Gives AI agents and autonomous tools a persistent, sandboxed filesystem they can read, write, stream, and watch — entirely in the browser with no server required.

Provides a familiar `IFS` interface with metadata, permissions, watch events, batch operations, and cross-tab sync.

## Features

- **Full filesystem API** - read, write, append, copy, move, remove, mkdir, stat, exists
- **Streaming** - readable and writable streams for large file I/O
- **Metadata** - attach arbitrary JSON metadata to any file or directory
- **Directory permissions** - read/write guards per directory
- **Watch events** - path-scoped subscriptions with cross-tab sync via BroadcastChannel
- **Batch operations** - transactional multi-file writes
- **Query** - filter directory entries by metadata
- **Mount scoping** - create chroot-style views into subdirectories
- **Metadata repair (fsck)** - rebuild `.meta` from actual OPFS state when corrupted or lost
- **Zero dependencies** - pure browser APIs only

## Quick start

```bash
pnpm add opfs-extended
```

```ts
import { createRoot } from 'opfs-extended'

// Create a root backed by an OPFS subdirectory
const root = await createRoot('my-app')
const fs = root.mount()

// Or mount the actual OPFS root
import { createRootFromHandle } from 'opfs-extended'
const handle = await navigator.storage.getDirectory()
const root = await createRootFromHandle('root', handle)
const fs = root.mount()
```

## API

### IFS

The filesystem interface returned by `root.mount()`:

```ts
// Reading
await fs.readFile('/data.bin')        // ArrayBuffer
await fs.readTextFile('/notes.txt')   // string
await fs.exists('/notes.txt')         // boolean
await fs.stat('/notes.txt')           // FileStat
await fs.ls('/')                      // FileEntry[]
await fs.readDir('/')                 // string[]

// Writing
await fs.writeFile('/hello.txt', 'world')
await fs.writeFile('/data.bin', arrayBuffer)
await fs.appendFile('/log.txt', 'new line\n')
await fs.mkdir('/deep/nested/dir', { recursive: true })

// Copy, move, remove
await fs.copyFile('/a.txt', '/b.txt')
await fs.moveFile('/old.txt', '/new.txt')
await fs.remove('/dir', { recursive: true })

// Metadata
await fs.setMeta('/file.txt', { tags: ['important'], author: 'alice' })
const meta = await fs.getMeta('/file.txt')

// Permissions
await fs.setPermissions('/secret', { write: false })

// Query
const docs = await fs.query('/docs', entry => entry.meta.tags?.includes('draft'))

// Batch (transactional)
await fs.batch(async (tx) => {
  await tx.writeFile('/a.txt', 'hello')
  await tx.writeFile('/b.txt', 'world')
})

// Streaming
const readable = await fs.createReadStream('/large-file.bin')
const reader = readable.getReader()
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  // process value (Uint8Array chunks)
}

const writable = await fs.createWriteStream('/output.bin', { meta: { type: 'export' } })
await writable.write('hello ')
await writable.write(new Uint8Array([0x01, 0x02]))
await writable.close()  // updates metadata and fires watch event

// Watch (path-scoped - watches directory and all descendants)
const unsub = fs.watch('/', (events) => {
  for (const e of events) {
    console.log(e.type, e.path)  // 'create' '/docs/new.txt'
  }
})
```

### IRoot

```ts
const fs = root.mount()           // mount at root
const scoped = root.mount('/sub') // chroot-style scoped view
const stats = await root.usage()  // { totalSize, fileCount, directoryCount }
await root.destroy()              // delete everything

// Repair metadata — scan OPFS and rebuild .meta files
const result = await root.fsck()  // { repaired: 2, entries: 15 }

// Auto-repair on mount
const root = await createRoot('my-app', { autoRepair: true })
```

### Watch events

Watchers are path-scoped. A watcher on `/` receives events from any descendant path. Events include the full path of the affected entry:

```ts
interface WatchEvent {
  type: 'create' | 'update' | 'delete'
  entry: FileEntry
  name: string   // filename
  path: string   // full path
}
```

Events sync across browser tabs via BroadcastChannel.

## Playground

An interactive playground is included for exploring the API:

```bash
pnpm install
pnpm dev
```

The playground provides:
- File tree with drag-and-drop move and file import
- Text editor with save
- File download/export
- Metadata and permissions editors
- Bash console (via just-bash) for CLI-style interaction
- Filename and metadata search (`meta:tags=component`)
- Event log with full event data
- Usage stats
- Multi-tab sync indicator
- Seed data button for quick demo setup

## Development

```bash
pnpm install
pnpm dev              # playground dev server
pnpm test             # run tests
pnpm typecheck        # typecheck library
pnpm typecheck:playground  # typecheck playground
pnpm build            # build library
```

## Architecture

- `src/root.ts` - Root management, OPFS handle wrapping, subscriber dispatch
- `src/mount.ts` - IFS implementation scoped to a mount path
- `src/stream.ts` - TrackedWritableStream with metadata updates on close
- `src/meta.ts` - `.meta` file read/write with Web Locks
- `src/batch.ts` - Transactional batch operations
- `src/broadcast.ts` - Cross-tab event sync via BroadcastChannel
- `src/types.ts` - All type definitions
- `playground/` - Interactive playground app
