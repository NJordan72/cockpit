import { useEffect, useMemo, useRef, useState } from 'react'
import type { Preset } from '@shared/config'
import type { DirEntry } from '@shared/ipc'
import { formatAgo } from '../sessions'
import { rankDirs } from './rankDirs'

interface Props {
  presets: Preset[]
  /** The agent launched last time. */
  initialPresetId: string
  projectsDir: string
  /** Tabs in the saved layout, offered for restoring; 0 for none. */
  restoreTabs: number
  inputRef: React.RefObject<HTMLInputElement | null>
  onLaunch: (presetId: string, cwd: string) => void
  onRestore: () => void
}

/**
 * The start screen, shown while no tabs are open: projects, most recently
 * used first, and a switch for the agent to open one with.
 */
export function Launcher({
  presets,
  initialPresetId,
  projectsDir,
  restoreTabs,
  inputRef,
  onLaunch,
  onRestore
}: Props): React.JSX.Element {
  // Presets that run a command are the agents; a plain shell is a Cmd+T away.
  const agents = useMemo(() => {
    const withCommand = presets.filter((p) => p.command)
    return withCommand.length > 0 ? withCommand : presets
  }, [presets])
  const [agentIdx, setAgentIdx] = useState(() =>
    Math.max(
      0,
      agents.findIndex((p) => p.id === initialPresetId)
    )
  )
  /** The directories, and when they were listed (what "2h ago" counts from). */
  const [listing, setListing] = useState<{ dirs: DirEntry[]; at: number } | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    let cancelled = false
    void window.cockpit.dirs.list().then((l) => {
      if (!cancelled) setListing({ dirs: l.dirs, at: Date.now() })
    })
    return () => {
      cancelled = true
    }
  }, [inputRef])

  const dirs = listing?.dirs
  const byPath = useMemo(() => new Map((dirs ?? []).map((d) => [d.path, d])), [dirs])
  const items = useMemo(() => rankDirs(query, null, dirs ?? []), [query, dirs])

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const agent = agents[agentIdx] ?? agents[0]
  const launch = (index: number): void => {
    const item = items[index]
    if (agent && item) onLaunch(agent.id, item.path)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    switch (e.key) {
      case 'Enter':
        e.preventDefault()
        launch(selected)
        break
      case 'ArrowDown':
        e.preventDefault()
        setSelected((s) => Math.min(s + 1, items.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelected((s) => Math.max(s - 1, 0))
        break
      case 'Tab':
        e.preventDefault()
        setAgentIdx((i) => (i + (e.shiftKey ? -1 : 1) + agents.length) % agents.length)
        break
      case 'Escape':
        e.preventDefault()
        setQuery('')
        setSelected(0)
        break
    }
  }

  return (
    <div className="launcher" onKeyDown={onKeyDown}>
      <div className="launcher-inner">
        <h1 className="launcher-title">Cockpit</h1>
        <div className="launcher-controls">
          <div className="launcher-agents" role="radiogroup" aria-label="Agent">
            {agents.map((p, i) => (
              <button
                type="button"
                tabIndex={-1}
                key={p.id}
                role="radio"
                aria-checked={i === agentIdx}
                className={i === agentIdx ? 'on' : ''}
                onClick={() => {
                  setAgentIdx(i)
                  inputRef.current?.focus()
                }}
              >
                {p.name}
              </button>
            ))}
          </div>
          {agents.length > 1 && (
            <span className="picker-hint">
              <kbd>⇥</kbd> switch
            </span>
          )}
          <span className="launcher-spacer" />
          {restoreTabs > 0 && (
            <button type="button" tabIndex={-1} className="launcher-restore" onClick={onRestore}>
              Restore last session ({restoreTabs} {restoreTabs === 1 ? 'tab' : 'tabs'})
            </button>
          )}
        </div>
        <input
          ref={inputRef}
          className="picker-input launcher-input"
          placeholder={`Filter projects in ${projectsDir}, or type a path`}
          value={query}
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value)
            setSelected(0)
          }}
        />
        <ul className="picker-list launcher-list" ref={listRef} role="listbox">
          {items.map((item, i) => {
            const entry = byPath.get(item.path)
            const usedWith = presets.find((p) => p.id === entry?.usedPresetId)?.name
            return (
              <li
                key={item.path}
                role="option"
                aria-selected={i === selected}
                className={i === selected ? 'selected' : ''}
                onMouseEnter={() => setSelected(i)}
                onClick={() => launch(i)}
              >
                <span className="dir-name">{item.label}</span>
                <span className="dir-path">{item.path}</span>
                {listing && entry && entry.usedMs > 0 && (
                  <span className="launcher-used">
                    {usedWith && `${usedWith} · `}
                    {formatAgo(entry.usedMs, listing.at)}
                  </span>
                )}
                {item.tag === 'path' && <span className="dir-tag">path</span>}
              </li>
            )
          })}
          {dirs && items.length === 0 && (
            <li className="picker-empty">
              {query ? 'No matching directories' : `Nothing in ${projectsDir} yet`}
            </li>
          )}
        </ul>
      </div>
    </div>
  )
}
