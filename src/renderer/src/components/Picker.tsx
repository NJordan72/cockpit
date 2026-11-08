import { useEffect, useMemo, useRef, useState } from 'react'
import type { Preset, RecentPage } from '@shared/config'
import type { DirEntry } from '@shared/ipc'
import { rankDirs } from './rankDirs'
import { rankPages } from './rankPages'

interface Props {
  title: string
  presets: Preset[]
  initialPresetId: string
  /** Shown first: usually the focused pane's directory. */
  currentDir: string | null
  onSubmit: (presetId: string, cwd: string) => void
  onOpenPage: (url: string) => void
  /** Cmd+Enter: a new task in the chosen directory's repository instead. */
  onTask?: (presetId: string, dir: string) => void
  onCancel: () => void
}

export function Picker({
  title,
  presets,
  initialPresetId,
  currentDir,
  onSubmit,
  onOpenPage,
  onTask,
  onCancel
}: Props): React.JSX.Element {
  const [dirs, setDirs] = useState<DirEntry[]>([])
  const [pages, setPages] = useState<RecentPage[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [presetIdx, setPresetIdx] = useState(() =>
    Math.max(
      0,
      presets.findIndex((p) => p.id === initialPresetId)
    )
  )
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    void window.cockpit.dirs.list().then((l) => setDirs(l.dirs))
    void window.cockpit.web.recent().then(setPages)
  }, [])

  // Web comes after the presets.
  const web = presetIdx === presets.length
  const items = useMemo(
    () =>
      web
        ? rankPages(query, pages).map((p) => ({
            key: p.url,
            label: p.label,
            detail: p.url,
            tag: p.tag
          }))
        : rankDirs(query, currentDir, dirs).map((d) => ({
            key: d.path,
            label: d.label,
            detail: d.path,
            tag: d.tag
          })),
    [web, query, pages, currentDir, dirs]
  )

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const preset = presets[presetIdx] ?? presets[0]
  const submit = (index: number): void => {
    const item = items[index]
    if (!item) return
    if (web) onOpenPage(item.key)
    else if (preset) onSubmit(preset.id, item.key)
  }
  const choose = (i: number): void => {
    setPresetIdx(i)
    setSelected(0)
    inputRef.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        onCancel()
        break
      case 'Enter': {
        e.preventDefault()
        const item = items[selected]
        if (e.metaKey && onTask && !web && preset && item) onTask(preset.id, item.key)
        else submit(selected)
        break
      }
      case 'ArrowDown':
        e.preventDefault()
        setSelected((s) => Math.min(s + 1, items.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelected((s) => Math.max(s - 1, 0))
        break
      case 'Tab': {
        e.preventDefault()
        const options = presets.length + 1
        setPresetIdx((i) => (i + (e.shiftKey ? -1 : 1) + options) % options)
        setSelected(0)
        break
      }
    }
  }

  return (
    <div className="picker-backdrop" onMouseDown={onCancel}>
      <div
        className="picker"
        role="dialog"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="picker-head">
          <span className="picker-title">{title}</span>
          <div className="picker-presets" role="radiogroup" aria-label="Preset">
            {presets.map((p, i) => (
              <button
                type="button"
                key={p.id}
                role="radio"
                aria-checked={i === presetIdx}
                className={i === presetIdx ? 'on' : ''}
                onClick={() => choose(i)}
              >
                {p.name}
              </button>
            ))}
            <button
              type="button"
              role="radio"
              aria-checked={web}
              className={web ? 'on' : ''}
              onClick={() => choose(presets.length)}
            >
              Web
            </button>
          </div>
          <span className="picker-hint">
            <kbd>⇥</kbd> preset
            {onTask && !web && (
              <>
                {' · '}
                <kbd>⌘⏎</kbd> task
              </>
            )}
          </span>
        </div>
        <input
          ref={inputRef}
          className="picker-input"
          placeholder={
            web ? 'Filter recent pages, or type an address' : 'Filter directories, or type a path'
          }
          value={query}
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value)
            setSelected(0)
          }}
        />
        <ul className="picker-list" ref={listRef} role="listbox">
          {items.map((item, i) => (
            <li
              key={item.key}
              role="option"
              aria-selected={i === selected}
              className={i === selected ? 'selected' : ''}
              onMouseEnter={() => setSelected(i)}
              onClick={() => submit(i)}
            >
              <span className="dir-name">{item.label}</span>
              <span className="dir-path">{item.detail}</span>
              {item.tag && <span className="dir-tag">{item.tag}</span>}
            </li>
          ))}
          {items.length === 0 && (
            <li className="picker-empty">
              {!web
                ? 'No matching directories'
                : pages.length > 0
                  ? 'No matching pages'
                  : 'No recent pages. Type an address to open one.'}
            </li>
          )}
        </ul>
      </div>
    </div>
  )
}
