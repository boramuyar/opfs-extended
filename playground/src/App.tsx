import { useState, useCallback } from 'react'
import type { IFS } from 'opfs-extended'
import { FSProvider, useFS } from './fs-context.tsx'
import { FileTree } from './file-tree.tsx'
import { EditorPanel } from './editor-panel.tsx'
import { OperationsPanel } from './operations-panel.tsx'
import { ConsolePanel } from './console-panel.tsx'
import { useTabCount } from './use-tab-count.ts'

export function App() {
  return (
    <FSProvider>
      <AppInner />
    </FSProvider>
  )
}

function AppInner() {
  const { root, fs, mountPath, mountTo, clearAll } = useFS()
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [selectedType, setSelectedType] = useState<'file' | 'directory' | null>(null)
  const tabCount = useTabCount()

  const handleSelect = useCallback((path: string, type: 'file' | 'directory') => {
    setSelectedPath(path)
    setSelectedType(type)
  }, [])

  const handleMount = useCallback(() => {
    const sub = prompt('Mount subpath:', '/sub')
    if (sub) mountTo(sub)
  }, [mountTo])

  const handleClearAll = useCallback(async () => {
    if (confirm('Clear all files? This deletes everything in OPFS.')) {
      await clearAll()
      setSelectedPath(null)
      setSelectedType(null)
    }
  }, [clearAll])

  if (!root || !fs) {
    return (
      <div className="h-screen flex items-center justify-center text-zinc-500 text-sm">
        Initializing filesystem...
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col">
      <header className="flex items-center gap-3 px-4 py-2 border-b border-zinc-800 bg-zinc-900 flex-shrink-0">
        <span className="text-sm font-semibold text-zinc-200">opfs-extended</span>
        <span className="text-xs text-zinc-500 font-mono">mount:{mountPath}</span>
        {tabCount > 1 && (
          <span className="text-xs text-emerald-400 font-mono">synced across {tabCount} tabs</span>
        )}
        <div className="ml-auto flex gap-2">
          <button onClick={() => seedExampleData(fs).catch(err => alert(`Seed failed: ${err}`))} className="text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300">
            Seed Data
          </button>
          <button onClick={handleMount} className="text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300">
            Mount...
          </button>
          <button onClick={() => mountTo('/')} className="text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300">
            Reset Mount
          </button>
          <button onClick={handleClearAll} className="text-xs px-2 py-1 rounded bg-red-900/50 hover:bg-red-800/50 text-red-300">
            Clear All
          </button>
        </div>
      </header>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 flex overflow-hidden min-h-0">
          <aside className="w-64 border-r border-zinc-800 flex-shrink-0 overflow-hidden">
            <FileTree fs={fs} selectedPath={selectedPath} onSelect={handleSelect} />
          </aside>
          <main className="flex-1 border-r border-zinc-800 overflow-hidden">
            <EditorPanel fs={fs} selectedPath={selectedPath} selectedType={selectedType} onDelete={() => { setSelectedPath(null); setSelectedType(null) }} />
          </main>
          <aside className="w-72 flex-shrink-0 overflow-hidden">
            <OperationsPanel fs={fs} root={root} />
          </aside>
        </div>
        <div className="h-[250px] flex-shrink-0 border-t border-zinc-800">
          <ConsolePanel fs={fs} />
        </div>
      </div>
    </div>
  )
}

async function seedExampleData(fs: IFS) {
  const files: Array<[string, string, Record<string, unknown>?]> = [
    ['/README.md', '# Example Project\n\nThis is seeded example data for the playground.', { tags: ['documentation', 'root'], priority: 'high' }],
    ['/docs/guide.md', '# User Guide\n\nGetting started with opfs-extended.', { tags: ['documentation', 'guide'], author: 'demo' }],
    ['/docs/api.md', '# API Reference\n\nFull API documentation.', { tags: ['documentation', 'api'], author: 'demo' }],
    ['/src/index.ts', 'export { App } from "./components/app"', { tags: ['source', 'entrypoint'], language: 'typescript' }],
    ['/src/components/app.tsx', 'export function App() { return <div>Hello</div> }', { tags: ['source', 'component'], language: 'tsx' }],
    ['/src/components/button.tsx', 'export function Button({ children }: { children: React.ReactNode }) { return <button>{children}</button> }', { tags: ['source', 'component', 'ui'], language: 'tsx' }],
    ['/assets/images/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#3b82f6"/></svg>', { tags: ['asset', 'image'], format: 'svg' }],
    ['/config.json', JSON.stringify({ name: 'example', version: '1.0.0', debug: false }, null, 2), { tags: ['config'], format: 'json' }],
  ]

  const dirs = new Set<string>()
  for (const [path] of files) {
    const parts = path.split('/').filter(Boolean)
    for (let i = 1; i < parts.length; i++) {
      dirs.add(`/${parts.slice(0, i).join('/')}`)
    }
  }
  for (const dir of [...dirs].sort()) {
    await fs.mkdir(dir, { recursive: true })
  }

  for (const [path, content, meta] of files) {
    await fs.writeFile(path, content)
    if (meta) await fs.setMeta(path, meta)
  }
}
