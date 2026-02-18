import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react'
import { Bash } from 'just-bash/browser'
import type { IFS } from 'opfs-extended'
import { OpfsBashAdapter } from './opfs-bash-adapter.ts'

interface Line {
  type: 'input' | 'output' | 'error'
  text: string
}

interface ConsolePanelProps {
  fs: IFS
}

export function ConsolePanel({ fs }: ConsolePanelProps) {
  const [lines, setLines] = useState<Line[]>([])
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [cwd, setCwd] = useState('/')
  const bashRef = useRef<Bash | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const adapter = new OpfsBashAdapter(fs)
    adapter.init().then(() => {
      bashRef.current = new Bash({ fs: adapter, cwd: '/', files: {} })
    })
  }, [fs])

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight)
  }, [lines])

  const exec = useCallback(async (command: string) => {
    if (!bashRef.current) return

    setLines((prev) => [...prev, { type: 'input', text: `${cwd} $ ${command}` }])
    setHistory((prev) => [...prev, command])
    setHistoryIndex(-1)
    setInput('')

    if (command === 'clear') {
      setLines([])
      return
    }

    try {
      const result = await bashRef.current.exec(command)
      const newLines: Line[] = []
      if (result.stdout) newLines.push({ type: 'output', text: result.stdout })
      if (result.stderr) newLines.push({ type: 'error', text: result.stderr })
      if (result.exitCode !== 0 && !result.stderr) {
        newLines.push({ type: 'error', text: `exit code ${result.exitCode}` })
      }
      setLines((prev) => [...prev, ...newLines])
      setCwd(bashRef.current.getCwd())
    } catch (err) {
      setLines((prev) => [...prev, { type: 'error', text: String(err) }])
    }
  }, [cwd])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && input.trim()) {
      exec(input.trim())
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (history.length === 0) return
      const newIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1)
      setHistoryIndex(newIndex)
      setInput(history[newIndex])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyIndex === -1) return
      const newIndex = historyIndex + 1
      if (newIndex >= history.length) {
        setHistoryIndex(-1)
        setInput('')
      } else {
        setHistoryIndex(newIndex)
        setInput(history[newIndex])
      }
    }
  }, [input, history, historyIndex, exec])

  return (
    <div className="flex flex-col h-full bg-zinc-950 font-mono text-xs">
      <div className="px-3 py-1.5 border-b border-zinc-800 text-zinc-400 text-[11px] flex-shrink-0">
        Console
      </div>
      <div ref={scrollRef} className="flex-1 overflow-auto p-2 space-y-0.5" onClick={() => inputRef.current?.focus()}>
        {lines.map((line, i) => (
          <div
            key={i}
            className={
              line.type === 'input'
                ? 'text-zinc-200'
                : line.type === 'error'
                  ? 'text-red-400'
                  : 'text-zinc-400'
            }
            style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
          >
            {line.text}
          </div>
        ))}
        <div className="flex items-center gap-1.5 text-zinc-200">
          <span className="text-zinc-500 flex-shrink-0">{cwd} $</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent outline-none caret-zinc-400"
            spellCheck={false}
            autoFocus
          />
        </div>
      </div>
    </div>
  )
}
