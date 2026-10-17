import { useEffect, useMemo, useRef, useState } from 'react'
import type { Preset } from '@shared/config'
import type { DirEntry } from '@shared/ipc'
import { rankDirs } from './rankDirs'

interface Props {
  title: string
  presets: Preset[]
  initialPresetId: string
  /** Shown first: usually the focused pane's directory. */
  currentDir: string | null
  onSubmit: (presetId: string, cwd: string) => void
  onCancel: () => void
}

export function Picker({
  title,
  presets,
  initialPresetId,
  currentDir,
  onSubmit,
  onCancel
}: Props): React.JSX.Element {
  const [dirs, setDirs] = useState<DirEntry[]>([])
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
  }, [])

  const items = useMemo(() => rankDirs(query, currentDir, dirs), [query, currentDir, dirs])

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const preset = presets[presetIdx] ?? presets[0]
  const submit = (index: number): void => {
    const item = items[index]
    if (preset && item) onSubmit(preset.id, item.path)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        onCancel()
        break
      case 'Enter':
        e.preventDefault()
        submit(selected)
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
        setPresetIdx((i) => (i + (e.shiftKey ? -1 : 1) + presets.length) % presets.length)
        break
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
                onClick={() => {
                  setPresetIdx(i)
                  inputRef.current?.focus()
                }}
              >
                {p.name}
              </button>
            ))}
          </div>
          <span className="picker-hint">
            <kbd>⇥</kbd> preset
          </span>
        </div>
        <input
          ref={inputRef}
          className="picker-input"
          placeholder="Filter directories, or type a path"
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
              key={item.path}
              role="option"
              aria-selected={i === selected}
              className={i === selected ? 'selected' : ''}
              onMouseEnter={() => setSelected(i)}
              onClick={() => submit(i)}
            >
              <span className="dir-name">{item.label}</span>
              <span className="dir-path">{item.path}</span>
              {item.tag && <span className="dir-tag">{item.tag}</span>}
            </li>
          ))}
          {items.length === 0 && <li className="picker-empty">No matching directories</li>}
        </ul>
      </div>
    </div>
  )
}
