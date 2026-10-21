import { useEffect, useRef, useState } from 'react'
import { toWebUrl } from '@shared/web'

export type OpenWhere = 'tab' | 'row'

interface Props {
  /** False on the start screen, where there is nothing to split. */
  canSplit: boolean
  onOpen: (url: string, where: OpenWhere) => void
  onCancel: () => void
}

/** Asks for a web address or a file path, and opens it in a new tab or beside the focused pane. */
export function OpenUrlDialog({ canSplit, onOpen, onCancel }: Props): React.JSX.Element {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const url = toWebUrl(text)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div className="picker-backdrop">
      <form
        className="secret-prompt"
        role="dialog"
        aria-label="Open web page"
        onSubmit={(e) => {
          e.preventDefault()
          if (url) onOpen(url, 'tab')
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          } else if (e.key === 'Enter' && e.shiftKey && canSplit) {
            e.preventDefault()
            if (url) onOpen(url, 'row')
          }
        }}
      >
        <div className="secret-title">Open a web page</div>
        <label className="secret-label" htmlFor="open-url">
          A web address, or the path to a file
        </label>
        <input
          id="open-url"
          ref={inputRef}
          className="picker-input"
          spellCheck={false}
          autoComplete="off"
          placeholder="https://example.com or /path/to/index.html"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="secret-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          {canSplit && (
            <button type="button" disabled={!url} onClick={() => url && onOpen(url, 'row')}>
              Split right <kbd>⇧⏎</kbd>
            </button>
          )}
          <button type="submit" className="primary" disabled={!url}>
            New tab <kbd>⏎</kbd>
          </button>
        </div>
      </form>
    </div>
  )
}
