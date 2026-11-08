import { useEffect, useMemo, useState } from 'react'
import type { DirEntry } from '@shared/ipc'
import { rankDirs } from '../components/rankDirs'

/** Suggestions shown under the field. */
const SUGGESTIONS = 6

interface Props {
  id: string
  value: string
  disabled: boolean
  onChange: (repo: string) => void
}

/** A repository path, with suggestions from the start screen's folders once it's typed in. */
export function RepoField({ id, value, disabled, onChange }: Props): React.JSX.Element {
  const [dirs, setDirs] = useState<DirEntry[]>([])
  /** Typed in since it took focus, so its suggestions show. */
  const [choosing, setChoosing] = useState(false)
  const [selected, setSelected] = useState(0)

  useEffect(() => {
    void window.cockpit.dirs.list().then((l) => setDirs(l.dirs))
  }, [])

  const suggestions = useMemo(
    () => (choosing ? rankDirs(value, null, dirs).slice(0, SUGGESTIONS) : []),
    [choosing, value, dirs]
  )

  const pick = (path: string): void => {
    onChange(path)
    setChoosing(false)
  }

  const onKey = (e: React.KeyboardEvent): void => {
    if (suggestions.length === 0) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setSelected((s) => Math.min(suggestions.length - 1, Math.max(0, s + step)))
    } else if (e.key === 'Enter') {
      const item = suggestions[selected]
      if (item) {
        e.preventDefault()
        e.stopPropagation()
        pick(item.path)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setChoosing(false)
    }
  }

  return (
    <div className="task-repo">
      <input
        id={id}
        className="picker-input"
        spellCheck={false}
        autoComplete="off"
        placeholder="~/dev/project"
        value={value}
        disabled={disabled}
        role="combobox"
        aria-expanded={suggestions.length > 0}
        aria-controls={`${id}-list`}
        onChange={(e) => {
          onChange(e.target.value)
          setChoosing(true)
          setSelected(0)
        }}
        onKeyDown={onKey}
        onBlur={() => setChoosing(false)}
      />
      {suggestions.length > 0 && (
        <ul className="picker-list task-repo-list" id={`${id}-list`} role="listbox">
          {suggestions.map((d, i) => (
            <li
              key={d.path}
              role="option"
              aria-selected={i === selected}
              className={i === selected ? 'selected' : ''}
              onMouseEnter={() => setSelected(i)}
              // Before the input's blur hides the list.
              onMouseDown={(e) => {
                e.preventDefault()
                pick(d.path)
              }}
            >
              <span className="dir-name">{d.label}</span>
              <span className="dir-path">{d.path}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
