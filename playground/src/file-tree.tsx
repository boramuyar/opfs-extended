import { useState, useCallback, useEffect, useRef, type DragEvent } from 'react'
import type { IFS, FileEntry } from 'opfs-extended'
import { joinPath } from 'opfs-extended'
import { useDirectory } from './use-directory.ts'

interface FileTreeProps {
  fs: IFS
  selectedPath: string | null
  onSelect: (path: string, type: 'file' | 'directory') => void
}

export function FileTree({ fs, selectedPath, onSelect }: FileTreeProps) {
  const [search, setSearch] = useState('')
  const [metaResults, setMetaResults] = useState<Array<{ path: string; entry: FileEntry }> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isMetaSearch = search.startsWith('meta:')

  // Async metadata search
  useEffect(() => {
    if (!isMetaSearch) {
      setMetaResults(null)
      return
    }
    const query = search.slice(5).trim().toLowerCase()
    if (!query) {
      setMetaResults([])
      return
    }

    let cancelled = false
    searchMeta(fs, '/', query).then(results => {
      if (!cancelled) setMetaResults(results)
    })
    return () => { cancelled = true }
  }, [fs, search, isMetaSearch])

  const handleUpload = useCallback(async (files: FileList, targetDir: string) => {
    for (const file of files) {
      const path = targetDir === '/' ? `/${file.name}` : `${targetDir}/${file.name}`
      const buffer = await file.arrayBuffer()
      await fs.writeFile(path, buffer)
    }
  }, [fs])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleUpload(e.target.files, '/')
      e.target.value = ''
    }
  }, [handleUpload])

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Files</span>
        <span className="flex gap-0.5 text-xs">
          <button onClick={() => fileInputRef.current?.click()} className="text-zinc-500 hover:text-zinc-200 px-1 text-base leading-none" title="Upload file">&#8593;</button>
          <TreeActions fs={fs} dirPath="/" />
        </span>
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileInput} />
      </div>
      <div className="px-2 py-1.5 border-b border-zinc-800">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search files... (meta:key=val)"
          className="w-full text-xs bg-zinc-900 text-zinc-300 px-2 py-1 rounded border border-zinc-700 focus:border-zinc-500 focus:outline-none placeholder:text-zinc-600"
        />
      </div>
      <div className="flex-1 overflow-y-auto p-1">
        {isMetaSearch ? (
          <MetaSearchResults results={metaResults} selectedPath={selectedPath} onSelect={onSelect} />
        ) : (
          <DirectoryNode
            fs={fs}
            path="/"
            name="/"
            depth={0}
            selectedPath={selectedPath}
            onSelect={onSelect}
            onUpload={handleUpload}
            search={search.toLowerCase()}
            defaultOpen
          />
        )}
      </div>
    </div>
  )
}

interface DirectoryNodeProps {
  fs: IFS
  path: string
  name: string
  depth: number
  selectedPath: string | null
  onSelect: (path: string, type: 'file' | 'directory') => void
  onUpload: (files: FileList, targetDir: string) => Promise<void>
  search: string
  defaultOpen?: boolean
}

function DirectoryNode({ fs, path, name, depth, selectedPath, onSelect, onUpload, search, defaultOpen }: DirectoryNodeProps) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  const [dropTarget, setDropTarget] = useState(false)
  const { entries } = useDirectory(fs, path)

  const toggle = useCallback(() => setOpen(o => !o), [])
  const isSelected = selectedPath === path

  const filteredEntries = search
    ? entries.filter(e => e.type === 'directory' || e.name.toLowerCase().includes(search))
    : entries

  // Auto-expand when searching
  const isOpen = search ? true : open

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()

    // Accept internal moves and external file drops
    if (e.dataTransfer.types.includes('application/x-opfs-path') || e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = e.dataTransfer.types.includes('Files') ? 'copy' : 'move'
      setDropTarget(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(false)
  }, [])

  const handleDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(false)

    // External file drop (import)
    if (e.dataTransfer.files.length > 0) {
      await onUpload(e.dataTransfer.files, path)
      return
    }

    // Internal move
    const sourcePath = e.dataTransfer.getData('application/x-opfs-path')
    if (!sourcePath || sourcePath === path) return

    const sourceName = sourcePath.split('/').pop()!
    const destPath = path === '/' ? `/${sourceName}` : `${path}/${sourceName}`
    if (sourcePath === destPath) return

    try {
      await fs.moveFile(sourcePath, destPath)
    } catch (err) {
      console.error('Move failed:', err)
    }
  }, [fs, path, onUpload])

  return (
    <div className={search ? 'search-dir hide-if-empty' : ''}>
      <div
        className={`dir-row flex items-center gap-1 px-2 py-0.5 cursor-pointer rounded text-sm hover:bg-zinc-800 group ${isSelected ? 'bg-zinc-800 text-white' : 'text-zinc-300'} ${dropTarget ? 'ring-1 ring-blue-500 bg-blue-500/10' : ''}`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => { toggle(); onSelect(path, 'directory') }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <span className="text-zinc-500 w-4 text-center flex-shrink-0">{isOpen ? '\u25BE' : '\u25B8'}</span>
        <span className="text-amber-400 flex-shrink-0">&#128193;</span>
        <span className="truncate">{name}</span>
        <span className="ml-auto opacity-0 group-hover:opacity-100">
          <TreeActions fs={fs} dirPath={path} />
        </span>
      </div>
      {isOpen && filteredEntries.map(entry => {
        const childPath = path === '/' ? `/${entry.name}` : joinPath(path, entry.name)
        return entry.type === 'directory' ? (
          <DirectoryNode key={entry.name} fs={fs} path={childPath} name={entry.name} depth={depth + 1} selectedPath={selectedPath} onSelect={onSelect} onUpload={onUpload} search={search} />
        ) : (
          <FileNode key={entry.name} path={childPath} name={entry.name} depth={depth + 1} isSelected={selectedPath === childPath} onSelect={onSelect} search={search} />
        )
      })}
    </div>
  )
}

interface FileNodeProps {
  path: string
  name: string
  depth: number
  isSelected: boolean
  onSelect: (path: string, type: 'file' | 'directory') => void
  search: string
}

function FileNode({ path, name, depth, isSelected, onSelect, search }: FileNodeProps) {
  const handleDragStart = useCallback((e: DragEvent) => {
    e.dataTransfer.setData('application/x-opfs-path', path)
    e.dataTransfer.effectAllowed = 'move'
  }, [path])

  // Dim non-matching files during search
  const matches = !search || name.toLowerCase().includes(search)
  if (search && !matches) return null

  return (
    <div
      className={`search-match flex items-center gap-1 px-2 py-0.5 cursor-pointer rounded text-sm hover:bg-zinc-800 group ${isSelected ? 'bg-zinc-800 text-white' : 'text-zinc-300'}`}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      onClick={() => onSelect(path, 'file')}
      draggable
      onDragStart={handleDragStart}
    >
      <span className="w-4 flex-shrink-0" />
      <span className="text-zinc-500 flex-shrink-0">&#128196;</span>
      <span className="truncate">{name}</span>
    </div>
  )
}

function TreeActions({ fs, dirPath }: { fs: IFS; dirPath: string }) {
  const createFile = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    const name = prompt('File name:')
    if (!name) return
    const path = dirPath === '/' ? `/${name}` : joinPath(dirPath, name)
    await fs.writeFile(path, '')
  }, [fs, dirPath])

  const createDir = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    const name = prompt('Folder name:')
    if (!name) return
    const path = dirPath === '/' ? `/${name}` : joinPath(dirPath, name)
    await fs.mkdir(path)
  }, [fs, dirPath])

  return (
    <span className="flex gap-0.5 text-xs">
      <button onClick={createFile} className="text-zinc-500 hover:text-zinc-200 px-1" title="New file">+&#128196;</button>
      <button onClick={createDir} className="text-zinc-500 hover:text-zinc-200 px-1" title="New folder">+&#128193;</button>
    </span>
  )
}

function MetaSearchResults({ results, selectedPath, onSelect }: {
  results: Array<{ path: string; entry: FileEntry }> | null
  selectedPath: string | null
  onSelect: (path: string, type: 'file' | 'directory') => void
}) {
  if (results === null) {
    return <div className="px-3 py-4 text-xs text-zinc-600 text-center">Searching...</div>
  }
  if (results.length === 0) {
    return <div className="px-3 py-4 text-xs text-zinc-600 text-center">No matches</div>
  }
  return (
    <div>
      {results.map(({ path, entry }) => (
        <div
          key={path}
          className={`flex items-center gap-1.5 px-2 py-1 cursor-pointer rounded text-sm hover:bg-zinc-800 ${selectedPath === path ? 'bg-zinc-800 text-white' : 'text-zinc-300'}`}
          onClick={() => onSelect(path, entry.type)}
        >
          <span className="flex-shrink-0">{entry.type === 'directory' ? '\uD83D\uDCC1' : '\uD83D\uDCC4'}</span>
          <div className="min-w-0">
            <div className="truncate">{path}</div>
            <div className="text-[10px] text-zinc-500 truncate">{JSON.stringify(entry.meta)}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

/** Recursively search for entries whose metadata matches the query. */
async function searchMeta(
  fs: IFS,
  dirPath: string,
  query: string,
): Promise<Array<{ path: string; entry: FileEntry }>> {
  const results: Array<{ path: string; entry: FileEntry }> = []

  // Parse query - supports "key=value" or just "value" (searches all meta values)
  const eqIndex = query.indexOf('=')
  const searchKey = eqIndex >= 0 ? query.slice(0, eqIndex) : null
  const searchValue = eqIndex >= 0 ? query.slice(eqIndex + 1) : query

  try {
    const entries = await fs.ls(dirPath)
    for (const entry of entries) {
      const childPath = dirPath === '/' ? `/${entry.name}` : `${dirPath}/${entry.name}`

      if (entryMetaMatches(entry, searchKey, searchValue)) {
        results.push({ path: childPath, entry })
      }

      if (entry.type === 'directory') {
        const sub = await searchMeta(fs, childPath, query)
        results.push(...sub)
      }
    }
  } catch {
    // Directory not readable
  }

  return results
}

function entryMetaMatches(entry: FileEntry, key: string | null, value: string): boolean {
  if (!entry.meta || Object.keys(entry.meta).length === 0) return false

  if (key) {
    const metaValue = entry.meta[key]
    if (metaValue === undefined) return false
    return String(metaValue).toLowerCase().includes(value)
      || (Array.isArray(metaValue) && metaValue.some(v => String(v).toLowerCase().includes(value)))
  }

  // Search all values
  return Object.values(entry.meta).some(v =>
    String(v).toLowerCase().includes(value)
    || (Array.isArray(v) && v.some(item => String(item).toLowerCase().includes(value)))
  )
}
