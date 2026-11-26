import { useEffect, useMemo, useRef, useState } from 'react'
import type { SavedCommand } from '@shared/commands'
import {
  buildPaletteItems,
  categoryLabel,
  filterPaletteItems,
  PALETTE_SCOPES,
  parsePaletteQuery,
  type PaletteEffect,
  type PaletteItem,
  type PaletteScope,
  type PaletteSource
} from './commandPaletteModel'

interface Props extends Omit<PaletteSource, 'slashCommands'> {
  /** Focused pane id, used to load repo-scoped slash commands. */
  focusedPaneId: string | null
  onSelect: (effect: PaletteEffect) => void
  onCancel: () => void
}

/**
 * Unified fuzzy command palette (Cmd+P) across sessions, tasks, runs,
 * quick commands, slash commands, layouts, themes, and app actions.
 */
export function CommandPalette({
  focusedPaneId,
  sessions,
  tasks,
  runs,
  quickCommands,
  presets,
  themes,
  currentTheme,
  layouts,
  currentLayout,
  canResetLayout,
  panelsHidden,
  windowCount,
  displays,
  keybindings,
  hasFocusedPane,
  onSelect,
  onCancel
}: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<PaletteScope>('all')
  const [selected, setSelected] = useState(0)
  const [slashCommands, setSlashCommands] = useState<SavedCommand[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const scopesRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    let cancelled = false
    void window.cockpit.commands.list(focusedPaneId).then((res) => {
      if (!cancelled) setSlashCommands(res.commands)
    })
    return () => {
      cancelled = true
    }
  }, [focusedPaneId])

  const parsed = useMemo(() => parsePaletteQuery(query, scope), [query, scope])

  const allItems = useMemo(
    () =>
      buildPaletteItems({
        sessions,
        tasks,
        runs,
        quickCommands,
        slashCommands,
        presets,
        themes,
        currentTheme,
        layouts,
        currentLayout,
        canResetLayout,
        panelsHidden,
        windowCount,
        displays,
        keybindings,
        hasFocusedPane
      }),
    [
      sessions,
      tasks,
      runs,
      quickCommands,
      slashCommands,
      presets,
      themes,
      currentTheme,
      layouts,
      currentLayout,
      canResetLayout,
      panelsHidden,
      windowCount,
      displays,
      keybindings,
      hasFocusedPane
    ]
  )

  const items = useMemo(() => filterPaletteItems(allItems, query, scope), [allItems, query, scope])

  const activeIndex = items.length === 0 ? 0 : Math.min(selected, items.length - 1)

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  useEffect(() => {
    scopesRef.current
      ?.querySelector('[aria-checked="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [parsed.scope])

  const choose = (item: PaletteItem | undefined): void => {
    if (!item || item.disabled) return
    onSelect(item.effect)
  }

  const chooseScope = (next: PaletteScope): void => {
    // Strip any explicit > or @ prefix when the user picks a scope chip.
    if (parsed.fromPrefix) setQuery(parsed.query)
    setScope(next)
    setSelected(0)
    inputRef.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        onCancel()
        break
      case 'Enter':
        e.preventDefault()
        choose(items[activeIndex])
        break
      case 'ArrowDown':
        e.preventDefault()
        setSelected((s) => Math.min(s + 1, Math.max(0, items.length - 1)))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelected((s) => Math.max(s - 1, 0))
        break
      case 'n':
        if (e.ctrlKey) {
          e.preventDefault()
          setSelected((s) => Math.min(s + 1, Math.max(0, items.length - 1)))
        }
        break
      case 'p':
        if (e.ctrlKey) {
          e.preventDefault()
          setSelected((s) => Math.max(s - 1, 0))
        }
        break
      case 'Tab': {
        e.preventDefault()
        const idx = PALETTE_SCOPES.findIndex((s) => s.id === parsed.scope)
        const nextIdx =
          (idx + (e.shiftKey ? -1 : 1) + PALETTE_SCOPES.length) % PALETTE_SCOPES.length
        const next = PALETTE_SCOPES[nextIdx]
        if (next) chooseScope(next.id)
        break
      }
    }
  }

  return (
    <div className="picker-backdrop" onMouseDown={onCancel}>
      <div
        className="picker command-palette"
        role="dialog"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="picker-head">
          <span className="picker-title">Command palette</span>
          <div className="picker-presets" role="radiogroup" aria-label="Filter" ref={scopesRef}>
            {PALETTE_SCOPES.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={parsed.scope === s.id}
                className={parsed.scope === s.id ? 'on' : ''}
                onClick={() => chooseScope(s.id)}
              >
                {s.prefix ? `${s.prefix} ${s.label}` : s.label}
              </button>
            ))}
          </div>
          <span className="picker-hint">
            <kbd>⇥</kbd> scope · <kbd>⏎</kbd> run
          </span>
        </div>
        <input
          ref={inputRef}
          className="picker-input"
          placeholder="Search sessions, tasks, commands, layouts, themes… (> commands, @ sessions)"
          value={query}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value)
            setSelected(0)
          }}
        />
        <ul className="picker-list" ref={listRef} role="listbox">
          {items.map((item, i) => (
            <li
              key={item.id}
              role="option"
              aria-selected={i === activeIndex}
              aria-disabled={item.disabled ? true : undefined}
              className={`${i === activeIndex ? 'selected' : ''}${item.disabled ? ' disabled' : ''}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => choose(item)}
            >
              {item.dot ? (
                <span className={`status-dot ${item.dot}`} aria-hidden />
              ) : (
                <span className="palette-cat">{categoryLabel(item.category)}</span>
              )}
              <span className="dir-name">{item.label}</span>
              <span className="dir-path">{item.detail}</span>
              {item.tag && <span className="dir-tag">{item.tag}</span>}
              {item.shortcut && <kbd className="palette-key">{item.shortcut}</kbd>}
            </li>
          ))}
          {items.length === 0 && (
            <li className="picker-empty">No matching commands or sessions.</li>
          )}
        </ul>
      </div>
    </div>
  )
}
