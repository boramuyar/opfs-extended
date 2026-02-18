import { useState, useEffect, useCallback } from 'react'
import type { IFS, FileStat, Permissions } from 'opfs-extended'

interface EditorPanelProps {
  fs: IFS
  selectedPath: string | null
  selectedType: 'file' | 'directory' | null
  onDelete?: () => void
}

export function EditorPanel({ fs, selectedPath, selectedType, onDelete }: EditorPanelProps) {
  if (!selectedPath) {
    return <EmptyState />
  }

  const handleDelete = useCallback(async () => {
    if (!selectedPath || selectedPath === '/') return
    const label = selectedType === 'directory' ? 'directory' : 'file'
    if (!confirm(`Delete ${label} "${selectedPath}"?`)) return
    await fs.remove(selectedPath, { recursive: true })
    onDelete?.()
  }, [fs, selectedPath, selectedType, onDelete])

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800">
        <span className="text-sm font-mono text-zinc-400 truncate">{selectedPath}</span>
        <span className="flex gap-1.5 flex-shrink-0 ml-2">
          {selectedType === 'file' && (
            <button onClick={() => downloadFile(fs, selectedPath)} className="text-xs px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300">
              Download
            </button>
          )}
          {selectedPath !== '/' && (
            <button onClick={handleDelete} className="text-xs px-2 py-0.5 rounded bg-red-900/50 hover:bg-red-800/50 text-red-300">
              Delete
            </button>
          )}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {selectedType === 'file' && <FileEditor fs={fs} path={selectedPath} />}
        <StatDisplay fs={fs} path={selectedPath} />
        <MetaEditor fs={fs} path={selectedPath} />
        {selectedType === 'directory' && <PermissionsEditor fs={fs} path={selectedPath} />}
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="h-full flex items-center justify-center text-zinc-600 text-sm">
      Select a file or directory
    </div>
  )
}

function FileEditor({ fs, path }: { fs: IFS; path: string }) {
  const [content, setContent] = useState('')
  const [saved, setSaved] = useState(true)

  useEffect(() => {
    let cancelled = false
    fs.readTextFile(path).then(text => {
      if (!cancelled) { setContent(text); setSaved(true) }
    }).catch(() => {
      if (!cancelled) setContent('[binary or unreadable]')
    })
    return () => { cancelled = true }
  }, [fs, path])

  const save = useCallback(async () => {
    await fs.writeFile(path, content)
    setSaved(true)
  }, [fs, path, content])

  return (
    <div className="border-b border-zinc-800">
      <div className="flex items-center justify-between px-4 py-1.5 bg-zinc-900">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Content</span>
        <button onClick={save} disabled={saved} className={`text-xs px-2 py-0.5 rounded ${saved ? 'text-zinc-600' : 'bg-blue-600 text-white hover:bg-blue-500'}`}>
          {saved ? 'Saved' : 'Save'}
        </button>
      </div>
      <textarea
        className="w-full h-48 bg-zinc-950 text-zinc-200 font-mono text-sm p-4 resize-none focus:outline-none"
        value={content}
        onChange={e => { setContent(e.target.value); setSaved(false) }}
        spellCheck={false}
      />
    </div>
  )
}

function StatDisplay({ fs, path }: { fs: IFS; path: string }) {
  const [stat, setStat] = useState<FileStat | null>(null)

  useEffect(() => {
    let cancelled = false
    fs.stat(path).then(s => { if (!cancelled) setStat(s) }).catch(() => { if (!cancelled) setStat(null) })
    return () => { cancelled = true }
  }, [fs, path])

  if (!stat) return null

  const rows = [
    ['Path', stat.path],
    ['Type', stat.type],
    ['Size', `${stat.size} bytes`],
    ['Created', new Date(stat.ctime).toLocaleString()],
    ['Modified', new Date(stat.mtime).toLocaleString()],
  ]

  return (
    <div className="border-b border-zinc-800">
      <div className="px-4 py-1.5 bg-zinc-900">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Stat</span>
      </div>
      <div className="px-4 py-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <span className="text-zinc-500">{label}</span>
            <span className="text-zinc-300 font-mono truncate">{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function MetaEditor({ fs, path }: { fs: IFS; path: string }) {
  const [metaJson, setMetaJson] = useState('{}')
  const [saved, setSaved] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fs.getMeta(path).then(m => {
      if (!cancelled) { setMetaJson(JSON.stringify(m, null, 2)); setSaved(true); setError(null) }
    }).catch(() => {
      if (!cancelled) { setMetaJson('{}'); setSaved(true) }
    })
    return () => { cancelled = true }
  }, [fs, path])

  const save = useCallback(async () => {
    try {
      const parsed = JSON.parse(metaJson) as Record<string, unknown>
      await fs.setMeta(path, parsed)
      setSaved(true)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [fs, path, metaJson])

  return (
    <div className="border-b border-zinc-800">
      <div className="flex items-center justify-between px-4 py-1.5 bg-zinc-900">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Metadata</span>
        <button onClick={save} disabled={saved} className={`text-xs px-2 py-0.5 rounded ${saved ? 'text-zinc-600' : 'bg-blue-600 text-white hover:bg-blue-500'}`}>
          {saved ? 'Saved' : 'Save'}
        </button>
      </div>
      <textarea
        className="w-full h-24 bg-zinc-950 text-zinc-200 font-mono text-sm p-4 resize-none focus:outline-none"
        value={metaJson}
        onChange={e => { setMetaJson(e.target.value); setSaved(false) }}
        spellCheck={false}
      />
      {error && <div className="px-4 py-1 text-xs text-red-400">{error}</div>}
    </div>
  )
}

async function downloadFile(fs: IFS, path: string) {
  const buffer = await fs.readFile(path)
  const blob = new Blob([buffer])
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = path.split('/').pop() ?? 'download'
  a.click()
  URL.revokeObjectURL(url)
}

function PermissionsEditor({ fs, path }: { fs: IFS; path: string }) {
  const [perms, setPerms] = useState<Permissions>({ read: true, write: true })

  useEffect(() => {
    fs.stat(path).then(() => {
      fs.getMeta(path).catch(() => null)
    }).catch(() => null)
  }, [fs, path])

  const toggle = useCallback(async (key: keyof Permissions) => {
    const next = { ...perms, [key]: !perms[key] }
    try {
      await fs.setPermissions(path, next)
      setPerms(next)
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err))
    }
  }, [fs, path, perms])

  return (
    <div className="border-b border-zinc-800">
      <div className="px-4 py-1.5 bg-zinc-900">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Permissions</span>
      </div>
      <div className="px-4 py-2 flex gap-4 text-sm">
        {(['read', 'write'] as const).map(key => (
          <label key={key} className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={perms[key]} onChange={() => toggle(key)} className="accent-blue-500" />
            <span className="text-zinc-300 capitalize">{key}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
