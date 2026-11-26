import { useEffect, useRef, useState } from 'react'
import type { Preset } from '@shared/config'
import { agentPresets } from '../agentSessions'
import { defaultComparePresets } from '../handoff/model'
import { RepoField } from '../tasks/RepoField'

interface Props {
  presets: Preset[]
  /** Preset of the focused pane, used to pick the default left agent. */
  focusedPresetId: string | null
  /** Directory suggested by default (usually the focused pane's cwd). */
  initialDir: string
  onCompare: (leftPresetId: string, rightPresetId: string, cwd: string, prompt: string) => void
  onCancel: () => void
}

/**
 * Opens two chosen agent presets side by side in a new split tab with the
 * same initial prompt.
 */
export function CompareAgentsDialog({
  presets,
  focusedPresetId,
  initialDir,
  onCompare,
  onCancel
}: Props): React.JSX.Element {
  const agents = agentPresets(presets)
  const pool = agents.length > 0 ? agents : presets
  const defaults = defaultComparePresets(presets, focusedPresetId)
  const [leftId, setLeftId] = useState(defaults?.[0] ?? pool[0]?.id ?? '')
  const [rightId, setRightId] = useState(defaults?.[1] ?? pool[0]?.id ?? '')
  const [cwd, setCwd] = useState(initialDir)
  const [prompt, setPrompt] = useState('')
  const promptRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    promptRef.current?.focus()
  }, [])

  const trimmedPrompt = prompt.trim()
  const trimmedCwd = cwd.trim()
  const canSubmit = Boolean(leftId && rightId && trimmedCwd && trimmedPrompt)

  const submit = (): void => {
    if (!canSubmit) return
    onCompare(leftId, rightId, trimmedCwd, trimmedPrompt)
  }

  return (
    <div className="picker-backdrop" onMouseDown={onCancel}>
      <form
        className="secret-prompt task-dialog compare-dialog"
        role="dialog"
        aria-label="Compare agents"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
      >
        <div className="task-dialog-head">
          <span className="secret-title">Compare agents</span>
        </div>

        <div className="compare-row">
          <span className="secret-label compare-side">Left</span>
          <div className="picker-presets" role="radiogroup" aria-label="Left agent">
            {pool.map((p) => (
              <button
                type="button"
                key={p.id}
                role="radio"
                aria-checked={p.id === leftId}
                className={p.id === leftId ? 'on' : ''}
                onClick={() => setLeftId(p.id)}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <div className="compare-row">
          <span className="secret-label compare-side">Right</span>
          <div className="picker-presets" role="radiogroup" aria-label="Right agent">
            {pool.map((p) => (
              <button
                type="button"
                key={p.id}
                role="radio"
                aria-checked={p.id === rightId}
                className={p.id === rightId ? 'on' : ''}
                onClick={() => setRightId(p.id)}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <label className="secret-label" htmlFor="compare-cwd">
          Directory
        </label>
        <RepoField id="compare-cwd" value={cwd} disabled={false} onChange={setCwd} />

        <label className="secret-label" htmlFor="compare-prompt">
          Prompt
        </label>
        <textarea
          id="compare-prompt"
          ref={promptRef}
          className="picker-input task-prompt"
          rows={4}
          spellCheck={false}
          placeholder="Prompt sent to both agents side by side"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
        />

        <p className="secret-hint">
          Opens both agents side by side in a new tab with the same initial prompt.
        </p>

        <div className="secret-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!canSubmit}>
            Compare <kbd>⏎</kbd>
          </button>
        </div>
      </form>
    </div>
  )
}
