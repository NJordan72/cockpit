import { useEffect, useMemo, useRef, useState } from 'react'
import type { Preset } from '@shared/config'
import { clipboardInput, inputValid, quickPrompt, type QuickCommand } from '@shared/quickCommands'

interface Props {
  commands: QuickCommand[]
  presets: Preset[]
  /** Open straight to this command's input step (e.g. from the command palette). */
  initialCommand?: QuickCommand | null
  /** Run it: `prompt` has the input filled in, `input` is the value typed. */
  onRun: (cmd: QuickCommand, prompt: string, input: string) => void
  onCancel: () => void
}

/** What a row says about how its command runs: "Claude Code · opus · medium · background". */
function detail(cmd: QuickCommand, preset: Preset | undefined): string {
  return [
    preset?.name ?? `no preset "${cmd.preset}"`,
    cmd.model,
    cmd.effort,
    cmd.background ? 'background' : 'in a tab'
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * Pick a quick command, then type its input if it takes one. A clipboard that
 * matches the input's pattern fills the field in, so a copied link takes
 * the shortcut, Enter, and Enter.
 */
export function QuickCommandDialog({
  commands,
  presets,
  initialCommand = null,
  onRun,
  onCancel
}: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [chosen, setChosen] = useState<QuickCommand | null>(initialCommand)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const runnable = (cmd: QuickCommand): boolean => presets.some((p) => p.id === cmd.preset)
  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? commands.filter((c) => c.label.toLowerCase().includes(q)) : commands
  }, [commands, query])

  useEffect(() => {
    inputRef.current?.focus()
  }, [chosen])

  useEffect(() => {
    if (!initialCommand?.input) return
    void window.cockpit.clipboard.readText().then((text) => {
      const filled = clipboardInput(initialCommand, text)
      if (filled) setValue((v) => v || filled)
    })
  }, [initialCommand])

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const run = (cmd: QuickCommand, input: string): void => {
    const prompt = quickPrompt(cmd, input)
    if (prompt !== null) onRun(cmd, prompt, input)
  }

  const choose = (cmd: QuickCommand | undefined): void => {
    if (!cmd || !runnable(cmd)) return
    if (!cmd.input) {
      run(cmd, '')
      return
    }
    setChosen(cmd)
    setValue('')
    void window.cockpit.clipboard.readText().then((text) => {
      const filled = clipboardInput(cmd, text)
      if (filled) setValue((v) => v || filled)
    })
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      // Back to the list from the input; out from the list (or when opened straight to one command).
      if (chosen && !initialCommand && commands.length > 1) {
        setChosen(null)
        setValue('')
      } else onCancel()
      return
    }
    if (chosen) {
      if (e.key === 'Enter') {
        e.preventDefault()
        run(chosen, value)
      }
      return
    }
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault()
      setSelected((i) => Math.min(i + 1, items.length - 1))
    } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault()
      setSelected((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(items[selected])
    }
  }

  const valid = chosen ? inputValid(chosen, value) : false

  return (
    <div className="picker-backdrop" onMouseDown={onCancel}>
      <div
        className="picker quick-command"
        role="dialog"
        aria-label="Quick command"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="picker-head">
          <span className="picker-title">{chosen ? chosen.label : 'Quick command'}</span>
          <span className="picker-hint">
            {chosen
              ? chosen.background
                ? '⏎ run in the background · esc back'
                : '⏎ run in a new tab · esc back'
              : '⏎ choose · esc close'}
          </span>
        </div>
        {chosen ? (
          <>
            <label className="quick-command-label" htmlFor="quick-input">
              {chosen.input?.label}
            </label>
            <input
              id="quick-input"
              ref={inputRef}
              className={`picker-input${value && !valid ? ' invalid' : ''}`}
              spellCheck={false}
              autoComplete="off"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <p className="quick-command-preview">
              {quickPrompt(chosen, value) ?? (value ? 'That doesn’t look right.' : ' ')}
            </p>
          </>
        ) : (
          <>
            <input
              ref={inputRef}
              className="picker-input"
              placeholder="Filter"
              spellCheck={false}
              autoComplete="off"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setSelected(0)
              }}
            />
            <ul className="picker-list" ref={listRef} role="listbox">
              {items.length === 0 ? (
                <li className="picker-empty">
                  {commands.length === 0
                    ? 'No quick commands yet: add them to quickCommands in ~/.cockpit/config.json.'
                    : 'No match.'}
                </li>
              ) : (
                items.map((cmd, i) => (
                  <li
                    key={cmd.id}
                    role="option"
                    aria-selected={i === selected}
                    aria-disabled={!runnable(cmd)}
                    className={`${i === selected ? 'selected' : ''}${runnable(cmd) ? '' : ' disabled'}`}
                    onMouseEnter={() => setSelected(i)}
                    onClick={() => choose(cmd)}
                  >
                    <span className="dir-name">{cmd.label}</span>
                    <span className="dir-path">
                      {detail(
                        cmd,
                        presets.find((p) => p.id === cmd.preset)
                      )}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
