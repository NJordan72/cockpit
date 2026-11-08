import { useEffect, useRef, useState } from 'react'
import type { Preset } from '@shared/config'
import {
  MAX_PARALLEL,
  prLine,
  type ExternalItem,
  type RunDraft,
  type RunMode,
  type TaskItem
} from '@shared/runs'
import { RepoField } from '../tasks/RepoField'

interface Props {
  draft: RunDraft
  presets: Preset[]
  initialPresetId: string
  /** The repository to suggest when the run doesn't name one: the focused pane's. */
  repo: string
  onDone: () => void
}

const MODES: { mode: RunMode; label: string; hint: string }[] = [
  {
    mode: 'merge',
    label: 'Wait for merges',
    hint: 'An item starts once every item it waits on has merged, on a branch from the default branch.'
  },
  {
    mode: 'stack',
    label: 'Stack pull requests',
    hint: "An item can start on top of a blocker whose pull request is open, on that blocker's branch."
  }
]

/**
 * Shows every item of a submitted run, with what it waits on and its full
 * prompt, before anything starts. Starting the run stands in for the New
 * task dialog for each item.
 */
export function RunDialog({
  draft,
  presets,
  initialPresetId,
  repo: suggested,
  onDone
}: Props): React.JSX.Element {
  const [mode, setMode] = useState<RunMode>(draft.mode)
  const [maxParallel, setMaxParallel] = useState(draft.maxParallel)
  const [presetId, setPresetId] = useState(
    () =>
      (
        presets.find((p) => p.id === draft.presetId) ??
        presets.find((p) => p.id === initialPresetId) ??
        presets[0]
      )?.id ?? 'claude'
  )
  const [repo, setRepo] = useState(draft.repo ?? suggested)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const startRef = useRef<HTMLButtonElement>(null)

  const tasks = draft.items.filter((i): i is TaskItem => i.external !== true)
  const outside = draft.items.filter((i): i is ExternalItem => i.external === true)
  const needsRepo = tasks.some((i) => !i.repo) && !draft.repo
  const runRepo = draft.repo ?? (repo.trim() === '' ? 'no repository yet' : repo.trim())
  const presetName = (id: string): string => presets.find((p) => p.id === id)?.name ?? id

  useEffect(() => {
    startRef.current?.focus()
  }, [])

  const cancel = (): void => {
    if (busy) return
    window.cockpit.runs.discard(draft.id)
    onDone()
  }

  const start = (): void => {
    if (busy) return
    if (needsRepo && !repo.trim()) {
      setError('Choose a repository')
      return
    }
    setBusy(true)
    setError(null)
    void window.cockpit.runs
      .start({
        id: draft.id,
        mode,
        maxParallel,
        presetId,
        ...(needsRepo ? { repo: repo.trim() } : {})
      })
      .then((r) => {
        if (r.ok) onDone()
        else {
          setError(r.error)
          setBusy(false)
        }
      })
      .catch((err: unknown) => {
        setError(String(err))
        setBusy(false)
      })
  }

  /** What the line Cockpit adds names as the base, before the item starts. */
  const baseFor = (after: readonly string[]): string =>
    mode === 'stack' && after.length > 0
      ? 'the default branch, or the branch of the item it starts on'
      : 'the default branch'

  return (
    <div className="picker-backdrop">
      <form
        className="secret-prompt task-dialog run-dialog"
        role="dialog"
        aria-label="Start a run"
        onSubmit={(e) => {
          e.preventDefault()
          start()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            cancel()
          }
        }}
      >
        <div className="task-dialog-head">
          <span className="secret-title">{draft.title}</span>
          <div className="picker-presets" role="radiogroup" aria-label="Agent">
            {presets.map((p) => (
              <button
                type="button"
                key={p.id}
                role="radio"
                aria-checked={p.id === presetId}
                className={p.id === presetId ? 'on' : ''}
                onClick={() => setPresetId(p.id)}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
        <p className="secret-hint run-from">
          From {draft.from}. {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
          {outside.length > 0 ? `, waiting on ${String(outside.length)} outside the run` : ''}.
        </p>

        <div className="run-choices">
          <div className="picker-presets" role="radiogroup" aria-label="Mode">
            {MODES.map((m) => (
              <button
                type="button"
                key={m.mode}
                role="radio"
                aria-checked={m.mode === mode}
                className={m.mode === mode ? 'on' : ''}
                title={m.hint}
                onClick={() => setMode(m.mode)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <label className="run-parallel">
            At a time
            <input
              type="number"
              className="picker-input"
              min={1}
              max={MAX_PARALLEL}
              value={maxParallel}
              disabled={busy}
              onChange={(e) => {
                const n = Math.round(Number(e.target.value))
                if (n >= 1 && n <= MAX_PARALLEL) setMaxParallel(n)
              }}
            />
          </label>
        </div>
        <p className="secret-hint">{MODES.find((m) => m.mode === mode)?.hint}</p>

        {needsRepo && (
          <>
            <label className="secret-label" htmlFor="run-repo">
              Repository
            </label>
            <RepoField
              id="run-repo"
              value={repo}
              disabled={busy}
              onChange={(r) => {
                setRepo(r)
                setError(null)
              }}
            />
          </>
        )}

        <ol className="run-dialog-items">
          {tasks.map((item) => (
            <li key={item.id}>
              <div className="run-dialog-item">
                <span className="prs-title">{item.title}</span>
                <span className="prs-number">{item.id}</span>
              </div>
              <div className="prs-meta">
                {item.after.length > 0 ? `Waits on ${item.after.join(', ')}` : 'Waits on nothing'}
                {' · '}
                {item.repo ?? runRepo}
                {' · '}
                {presetName(item.presetId ?? presetId)}
              </div>
              <div className="prs-meta">⎇ {item.branch}</div>
              <details>
                <summary>Prompt</summary>
                <pre className="run-prompt">
                  {item.prompt}
                  {'\n\n'}
                  {prLine(baseFor(item.after))}
                </pre>
              </details>
            </li>
          ))}
          {outside.map((item) => (
            <li key={item.id}>
              <div className="run-dialog-item">
                <span className="prs-title">{item.title}</span>
                <span className="prs-number">{item.id}</span>
              </div>
              <div className="prs-meta">
                Outside the run. Cockpit waits on it and never starts it, until{' '}
                {item.pr ? 'its pull request merges' : 'it is marked done'}.
              </div>
            </li>
          ))}
        </ol>

        <p className="secret-hint">
          {error ? (
            <span className="task-error">{error}</span>
          ) : busy ? (
            'Starting the run…'
          ) : (
            'Nothing starts until you click Start. Each item then starts in a task of its own, in a background tab, without asking again.'
          )}
        </p>
        <div className="secret-actions">
          <button type="button" disabled={busy} onClick={cancel}>
            Cancel
          </button>
          <button type="submit" ref={startRef} className="primary" disabled={busy}>
            Start <kbd>⏎</kbd>
          </button>
        </div>
      </form>
    </div>
  )
}
