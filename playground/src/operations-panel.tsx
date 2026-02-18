import { useState, useEffect, useCallback, useRef } from 'react'
import type { IFS, IRoot, WatchEvent, UsageStats } from 'opfs-extended'

interface OperationsPanelProps {
  fs: IFS
  root: IRoot
}

export function OperationsPanel({ fs, root }: OperationsPanelProps) {
  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-zinc-800">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Operations</span>
      </div>
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-shrink-0">
          <QuickActions fs={fs} />
          <UsageDisplay fs={fs} root={root} />
        </div>
        <EventLog fs={fs} />
      </div>
    </div>
  )
}

function QuickActions({ fs }: { fs: IFS }) {
  const [output, setOutput] = useState<string | null>(null)

  const run = useCallback(async (label: string, fn: () => Promise<unknown>) => {
    try {
      const result = await fn()
      setOutput(`[${label}] OK${result !== undefined ? `: ${JSON.stringify(result)}` : ''}`)
    } catch (err) {
      setOutput(`[${label}] Error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [])

  const actions: { label: string; run: () => void }[] = [
    {
      label: 'Create File',
      run: () => {
        const path = prompt('Path:', '/hello.txt')
        const content = prompt('Content:', 'Hello, OPFS!')
        if (path) run('create', () => fs.writeFile(path, content ?? ''))
      },
    },
    {
      label: 'mkdir',
      run: () => {
        const path = prompt('Dir path:', '/my-dir')
        if (path) run('mkdir', () => fs.mkdir(path, { recursive: true }))
      },
    },
    {
      label: 'Copy',
      run: () => {
        const src = prompt('Source path:')
        const dest = prompt('Destination path:')
        if (src && dest) run('copy', () => fs.copyFile(src, dest))
      },
    },
    {
      label: 'Move',
      run: () => {
        const src = prompt('Source path:')
        const dest = prompt('Destination path:')
        if (src && dest) run('move', () => fs.moveFile(src, dest))
      },
    },
    {
      label: 'Append',
      run: () => {
        const path = prompt('File path:')
        const data = prompt('Data to append:')
        if (path && data) run('append', () => fs.appendFile(path, data))
      },
    },
    {
      label: 'Batch Write',
      run: () => {
        const count = parseInt(prompt('Number of files:', '5') ?? '0', 10)
        if (count > 0) {
          run('batch', () => fs.batch(async (tx) => {
            for (let i = 0; i < count; i++) {
              await tx.writeFile(`/batch-${i}.txt`, `File ${i} content`)
            }
          }))
        }
      },
    },
    {
      label: 'Query',
      run: () => {
        const dir = prompt('Directory:', '/')
        const pattern = prompt('Name contains:', '')
        if (dir) {
          run('query', () => fs.query(dir, (entry) => entry.name.includes(pattern ?? '')).then(entries => entries.map(e => e.name)))
        }
      },
    },
    {
      label: 'utimes',
      run: () => {
        const path = prompt('File path:')
        if (path) run('utimes', () => fs.utimes(path, new Date()))
      },
    },
    {
      label: 'Read File',
      run: () => {
        const path = prompt('File path:')
        if (path) run('read', () => fs.readTextFile(path))
      },
    },
    {
      label: 'Delete',
      run: () => {
        const path = prompt('Path to delete:')
        if (path) run('delete', () => fs.remove(path, { recursive: true }))
      },
    },
  ]

  return (
    <div className="border-b border-zinc-800">
      <div className="px-3 py-1.5 bg-zinc-900">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Quick Actions</span>
      </div>
      <div className="p-2 flex flex-wrap gap-1.5">
        {actions.map(a => (
          <button key={a.label} onClick={a.run} className="text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors">
            {a.label}
          </button>
        ))}
      </div>
      {output && (
        <div className="px-3 pb-2">
          <pre className="text-xs font-mono text-zinc-400 bg-zinc-900 p-2 rounded overflow-x-auto whitespace-pre-wrap break-all">{output}</pre>
        </div>
      )}
    </div>
  )
}

function UsageDisplay({ fs, root }: { fs: IFS; root: IRoot }) {
  const [stats, setStats] = useState<UsageStats | null>(null)

  const refresh = useCallback(async () => {
    try {
      setStats(await root.usage())
    } catch {
      setStats(null)
    }
  }, [root])

  useEffect(() => { refresh() }, [refresh])

  // Re-refresh on root watch
  useEffect(() => {
    const unsub = fs.watch('/', () => { refresh() })
    return unsub
  }, [fs, refresh])

  return (
    <div className="border-b border-zinc-800">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Usage</span>
        <button onClick={refresh} className="text-xs text-zinc-500 hover:text-zinc-300">Refresh</button>
      </div>
      {stats && (
        <div className="px-3 py-2 grid grid-cols-3 gap-2 text-center">
          <Stat label="Files" value={stats.fileCount} />
          <Stat label="Dirs" value={stats.directoryCount} />
          <Stat label="Bytes" value={stats.totalSize} />
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-lg font-semibold text-zinc-200">{value}</div>
      <div className="text-xs text-zinc-500">{label}</div>
    </div>
  )
}

const EVENT_COLORS: Record<string, string> = {
  create: 'text-green-400',
  update: 'text-blue-400',
  delete: 'text-red-400',
}

function EventLog({ fs }: { fs: IFS }) {
  const [events, setEvents] = useState<Array<WatchEvent & { id: number }>>([])
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const nextId = useRef(0)

  useEffect(() => {
    const unsub = fs.watch('/', (newEvents) => {
      setEvents(prev => {
        const additions = newEvents.map(e => ({ ...e, id: nextId.current++ }))
        return [...additions, ...prev].slice(0, 100)
      })
    })
    return unsub
  }, [fs])

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900 flex-shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Event Log</span>
        <button onClick={() => setEvents([])} className="text-xs text-zinc-500 hover:text-zinc-300">Clear</button>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {events.length === 0 && (
          <div className="px-3 py-4 text-xs text-zinc-600 text-center">No events yet</div>
        )}
        {events.map(evt => (
          <div key={evt.id} className="border-b border-zinc-900">
            <div
              className="px-3 py-1 text-xs font-mono flex gap-2 cursor-pointer hover:bg-zinc-800/50"
              onClick={() => setExpandedId(expandedId === evt.id ? null : evt.id)}
            >
              <span className={`font-semibold ${EVENT_COLORS[evt.type] ?? 'text-zinc-400'}`}>{evt.type.toUpperCase()}</span>
              <span className="text-zinc-400 truncate">{evt.path}</span>
            </div>
            {expandedId === evt.id && (
              <pre className="px-3 py-2 text-[11px] text-zinc-400 bg-zinc-950 overflow-x-auto">
                {JSON.stringify(evt, null, 2)}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
