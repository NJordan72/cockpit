import { useEffect, useMemo, useRef, useState } from 'react'
import type { Preset } from '@shared/config'
import type { DirEntry } from '@shared/ipc'
import { validBranch, type TaskDraft } from '@shared/tasks'
import { rankDirs } from '../components/rankDirs'

/** Suggestions shown under the repository field. */
const SUGGESTIONS = 6

export interface CreatedTask {
  /** The worktree, with ~ for home. */
  path: string
  /** The branch had a worktree already. */
  existing: boolean
  presetId: string
  prompt: string
}

interface Props {
  presets: Preset[]
  initialPresetId: string
  draft: TaskDraft
  /** The repository to suggest: the focused pane's. */
  repo: string
  onCreated: (task: CreatedTask) => void
  onCancel: () => void
}

/**
 * Asks for a branch, a repository, an agent, and a first prompt, then has
 * main make the worktree. The tab opens once it exists.
 */
export function TaskDialog({
  presets,
  initialPresetId,
  draft,
  repo: suggested,
  onCreated,
  onCancel
}: Props): React.JSX.Element {
  const [branch, setBranch] = useState(draft.branch ?? '')
  const [repo, setRepo] = useState(draft.repo ?? suggested)
  const [prompt, setPrompt] = useState(draft.prompt ?? '')
  const [presetId, setPresetId] = useState(
    () =>
      (
        presets.find((p) => p.id === draft.presetId) ??
        presets.find((p) => p.id === initialPresetId) ??
        presets[0]
      )?.id ?? 'shell'
  )
  const [dirs, setDirs] = useState<DirEntry[]>([])
  /** The repository field was typed in since it took focus, so its suggestions show. */
  const [choosing, setChoosing] = useState(false)
  const [selected, setSelected] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const branchRef = useRef<HTMLInputElement>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    // A widget's draft names the branch; what's left to write is the prompt.
    if (draft.branch && !draft.prompt) promptRef.current?.focus()
    else branchRef.current?.focus()
    void window.cockpit.dirs.list().then((l) => setDirs(l.dirs))
  }, [draft])

  const suggestions = useMemo(
    () => (choosing ? rankDirs(repo, null, dirs).slice(0, SUGGESTIONS) : []),
    [choosing, repo, dirs]
  )

  const name = branch.trim()
  const branchOk = validBranch(name)

  const submit = (): void => {
    if (busy) return
    if (!branchOk) {
      setError(name ? `"${name}" isn't a branch name git accepts` : 'Name the branch')
      branchRef.current?.focus()
      return
    }
    if (!repo.trim()) {
      setError('Choose a repository')
      return
    }
    setBusy(true)
    setError(null)
    void window.cockpit.tasks
      .create({ repo: repo.trim(), branch: name })
      .then((r) => {
        if (r.ok) onCreated({ path: r.path, existing: r.existing, presetId, prompt: prompt.trim() })
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

  const pick = (path: string): void => {
    setRepo(path)
    setChoosing(false)
  }

  const onRepoKey = (e: React.KeyboardEvent): void => {
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
    <div className="picker-backdrop">
      <form
        className="secret-prompt task-dialog"
        role="dialog"
        aria-label="New task"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) {
            e.preventDefault()
            onCancel()
          }
        }}
      >
        <div className="task-dialog-head">
          <span className="secret-title">New task</span>
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

        <label className="secret-label" htmlFor="task-branch">
          Branch
        </label>
        <input
          id="task-branch"
          ref={branchRef}
          className={`picker-input${name && !branchOk ? ' invalid' : ''}`}
          spellCheck={false}
          autoComplete="off"
          placeholder="nick/sc-1234/fix-the-login-redirect"
          value={branch}
          disabled={busy}
          onChange={(e) => {
            setBranch(e.target.value)
            setError(null)
          }}
        />

        <label className="secret-label" htmlFor="task-repo">
          Repository
        </label>
        <div className="task-repo">
          <input
            id="task-repo"
            className="picker-input"
            spellCheck={false}
            autoComplete="off"
            placeholder="~/dev/project"
            value={repo}
            disabled={busy}
            role="combobox"
            aria-expanded={suggestions.length > 0}
            aria-controls="task-repo-list"
            onChange={(e) => {
              setRepo(e.target.value)
              setChoosing(true)
              setSelected(0)
              setError(null)
            }}
            onKeyDown={onRepoKey}
            onBlur={() => setChoosing(false)}
          />
          {suggestions.length > 0 && (
            <ul className="picker-list task-repo-list" id="task-repo-list" role="listbox">
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

        <label className="secret-label" htmlFor="task-prompt">
          First prompt <span className="task-optional">(optional)</span>
        </label>
        <textarea
          id="task-prompt"
          ref={promptRef}
          className="picker-input task-prompt"
          rows={3}
          spellCheck={false}
          placeholder="What the agent should do"
          value={prompt}
          disabled={busy}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
        />

        <p className="secret-hint">
          {error ? (
            <span className="task-error">{error}</span>
          ) : busy ? (
            'Fetching and making the worktree…'
          ) : (
            "A new branch starts from the remote's default branch, fetched first. A branch that exists already is checked out."
          )}
        </p>
        <div className="secret-actions">
          <button type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy || !branchOk}>
            Create <kbd>⏎</kbd>
          </button>
        </div>
      </form>
    </div>
  )
}
