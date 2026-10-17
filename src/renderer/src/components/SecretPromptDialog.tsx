import { useEffect, useRef, useState } from 'react'
import type { SecretPrompt } from '@shared/widgets'

interface Props {
  prompt: SecretPrompt
  /** null when the user cancels. */
  onAnswer: (value: string | null) => void
}

/**
 * The host's own prompt for a secret a widget asked for. It's drawn by the
 * chrome, over the whole window, so a widget can trigger it but never draw
 * it or see what's typed until it's saved.
 */
export function SecretPromptDialog({ prompt, onAnswer }: Props): React.JSX.Element {
  const [value, setValue] = useState('')
  const formRef = useRef<HTMLFormElement>(null)

  // Take focus away from the terminal, but not into the input: keys typed
  // for a terminal must not end up in the secret, or submit it with Enter.
  useEffect(() => {
    formRef.current?.focus()
  }, [])

  const trimmed = value.trim()

  return (
    <div className="picker-backdrop">
      <form
        ref={formRef}
        tabIndex={-1}
        className="secret-prompt"
        role="dialog"
        aria-label={`Secret for ${prompt.widgetName}`}
        onSubmit={(e) => {
          e.preventDefault()
          if (trimmed) onAnswer(trimmed)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onAnswer(null)
          }
        }}
      >
        <div className="secret-title">
          <strong>{prompt.widgetName}</strong> is asking for a secret
        </div>
        <label className="secret-label" htmlFor="secret-input">
          <code>{prompt.name}</code>
        </label>
        <input
          id="secret-input"
          className="picker-input"
          placeholder="Click here, then paste"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <p className="secret-hint">
          Saved encrypted with a key in your macOS Keychain. Only the widget{' '}
          <code>{prompt.widgetId}</code> can read it.
        </p>
        <div className="secret-actions">
          <button type="button" onClick={() => onAnswer(null)}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!trimmed}>
            Save
          </button>
        </div>
      </form>
    </div>
  )
}
