import { useEffect, useRef, useState } from 'react'
import { COMMAND_NAME, suggestName, type CommandScope } from '@shared/commands'

interface Props {
  prompt: string
  /** The pane whose repository a repo command goes in. */
  paneId: string | null
  onClose: (saved: boolean) => void
}

/** Saves a prompt as a Claude Code slash command. */
export function SaveCommandDialog({ prompt, paneId, onClose }: Props): React.JSX.Element {
  const [name, setName] = useState(() => suggestName(prompt))
  const [description, setDescription] = useState('')
  const [body, setBody] = useState(prompt)
  const [scope, setScope] = useState<CommandScope>('global')
  const [error, setError] = useState<string | null>(null)
  const [exists, setExists] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.select()
  }, [])

  const valid = COMMAND_NAME.test(name) && body.trim() !== ''

  const save = async (overwrite: boolean): Promise<void> => {
    const r = await window.cockpit.commands.save(paneId, {
      name,
      scope,
      body,
      description,
      overwrite
    })
    if (r.ok) {
      onClose(true)
      return
    }
    setError(r.error)
    setExists(r.exists === true)
  }

  return (
    <div className="picker-backdrop">
      <form
        className="secret-prompt save-command"
        role="dialog"
        aria-label="Save as command"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) void save(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose(false)
          }
        }}
      >
        <div className="secret-title">Save as a slash command</div>
        <label className="secret-label" htmlFor="command-name">
          Name
        </label>
        <div className="save-command-name">
          <span>/</span>
          <input
            id="command-name"
            ref={nameRef}
            className="picker-input"
            spellCheck={false}
            autoComplete="off"
            value={name}
            onChange={(e) => {
              setName(e.target.value.toLowerCase())
              setError(null)
              setExists(false)
            }}
          />
        </div>
        <label className="secret-label" htmlFor="command-desc">
          Description{' '}
          <span className="save-command-optional">(optional, shown in Claude&apos;s / menu)</span>
        </label>
        <input
          id="command-desc"
          className="picker-input"
          autoComplete="off"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <label className="secret-label" htmlFor="command-body">
          Prompt{' '}
          <span className="save-command-optional">
            ($ARGUMENTS is whatever follows the command)
          </span>
        </label>
        <textarea
          id="command-body"
          className="picker-input save-command-body"
          spellCheck={false}
          rows={8}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="save-command-scope" role="radiogroup" aria-label="Where">
          <label>
            <input type="radio" checked={scope === 'global'} onChange={() => setScope('global')} />{' '}
            Everywhere <code>~/.claude/commands/</code>
          </label>
          <label>
            <input type="radio" checked={scope === 'repo'} onChange={() => setScope('repo')} /> This
            repo <code>.claude/commands/</code>
          </label>
        </div>
        {error && <p className="save-command-error">{error}</p>}
        <div className="secret-actions">
          <button type="button" onClick={() => onClose(false)}>
            Cancel
          </button>
          {exists ? (
            <button type="button" className="primary" onClick={() => void save(true)}>
              Replace /{name}
            </button>
          ) : (
            <button type="submit" className="primary" disabled={!valid}>
              Save
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
