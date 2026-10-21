import { useCallback, useEffect, useRef, useState } from 'react'
import type { PaneNode } from '@shared/config'
import { canOpenExternally, toWebUrl, WEB_PARTITION } from '@shared/web'
import { webPanes } from './registry'

/** The parts of Electron's WebviewTag used here; the renderer has no Electron types. */
interface Webview extends HTMLElement {
  getURL(): string
  getTitle(): string
  loadURL(url: string): Promise<void>
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  reload(): void
  stop(): void
}

interface Props {
  pane: PaneNode & { url: string }
  focused: boolean
  visible: boolean
  onFocus: () => void
  onPage: (url: string, title: string | undefined) => void
}

/**
 * A web page in a pane, in a <webview>. Main strips any preload from it and
 * gives it its own partition, so the page gets no Node and no Cockpit API.
 */
export function WebPane({ pane, focused, visible, onFocus, onPage }: Props): React.JSX.Element {
  const { id } = pane
  const viewRef = useRef<Webview>(null)
  // The webview navigates whenever src changes, so it only gets the first URL.
  const [initialUrl] = useState(pane.url)
  const [address, setAddress] = useState(pane.url)
  const [editing, setEditing] = useState(false)
  const [nav, setNav] = useState({ back: false, forward: false, loading: true })
  const [error, setError] = useState<string | null>(null)
  const ready = useRef(false)
  const callbacks = useRef({ onFocus, onPage })
  useEffect(() => {
    callbacks.current = { onFocus, onPage }
  })

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const sync = (): void => {
      if (!ready.current) return
      const url = view.getURL()
      const title = view.getTitle()
      setNav((n) => ({ ...n, back: view.canGoBack(), forward: view.canGoForward() }))
      setEditing((e) => {
        if (!e) setAddress(url)
        return e
      })
      callbacks.current.onPage(url, title && title !== url ? title : undefined)
    }
    const onReady = (): void => {
      ready.current = true
      sync()
    }
    const onStart = (): void => {
      setError(null)
      setNav((n) => ({ ...n, loading: true }))
    }
    const onStop = (): void => {
      setNav((n) => ({ ...n, loading: false }))
      sync()
    }
    const onFail = (e: Event): void => {
      const { errorCode, errorDescription, isMainFrame } = e as Event & {
        errorCode: number
        errorDescription: string
        isMainFrame: boolean
      }
      // -3 is a load the user replaced with another one.
      if (isMainFrame && errorCode !== -3) setError(errorDescription || `Error ${errorCode}`)
    }
    view.addEventListener('dom-ready', onReady)
    view.addEventListener('did-start-loading', onStart)
    view.addEventListener('did-stop-loading', onStop)
    view.addEventListener('did-navigate', sync)
    view.addEventListener('did-navigate-in-page', sync)
    view.addEventListener('page-title-updated', sync)
    view.addEventListener('did-fail-load', onFail)
    // Clicks inside the page never reach this document; focus does.
    view.addEventListener('focus', () => callbacks.current.onFocus())
    webPanes.set(id, {
      focus: () => view.focus(),
      reload: () => {
        if (ready.current) view.reload()
      }
    })
    return () => {
      webPanes.delete(id)
      view.removeEventListener('dom-ready', onReady)
      view.removeEventListener('did-start-loading', onStart)
      view.removeEventListener('did-stop-loading', onStop)
      view.removeEventListener('did-navigate', sync)
      view.removeEventListener('did-navigate-in-page', sync)
      view.removeEventListener('page-title-updated', sync)
      view.removeEventListener('did-fail-load', onFail)
    }
  }, [id])

  useEffect(() => {
    if (focused && visible && !editing) viewRef.current?.focus()
  }, [focused, visible, editing])

  const go = useCallback((text: string) => {
    const url = toWebUrl(text)
    const view = viewRef.current
    if (!url) {
      setError(`Not a web address: ${text}`)
      return
    }
    setEditing(false)
    setAddress(url)
    if (view && ready.current) void view.loadURL(url).catch(() => undefined)
  }, [])

  const run = (fn: (v: Webview) => void): void => {
    const view = viewRef.current
    if (view && ready.current) fn(view)
  }
  // Toolbar buttons leave the keyboard in the page.
  const keepFocus = (e: React.MouseEvent): void => {
    e.preventDefault()
  }

  return (
    <div className={`web-pane${focused ? ' focused' : ''}`} onMouseDown={onFocus}>
      <form
        className="web-bar"
        onSubmit={(e) => {
          e.preventDefault()
          go(address)
        }}
      >
        <button
          type="button"
          tabIndex={-1}
          title="Back"
          disabled={!nav.back}
          onMouseDown={keepFocus}
          onClick={() => run((v) => v.goBack())}
        >
          ‹
        </button>
        <button
          type="button"
          tabIndex={-1}
          title="Forward"
          disabled={!nav.forward}
          onMouseDown={keepFocus}
          onClick={() => run((v) => v.goForward())}
        >
          ›
        </button>
        <button
          type="button"
          tabIndex={-1}
          title={nav.loading ? 'Stop' : 'Reload'}
          onMouseDown={keepFocus}
          onClick={() => run((v) => (nav.loading ? v.stop() : v.reload()))}
        >
          {nav.loading ? '×' : '⟳'}
        </button>
        <input
          className="web-address"
          aria-label="Address"
          spellCheck={false}
          autoComplete="off"
          value={address}
          onFocus={(e) => {
            setEditing(true)
            e.currentTarget.select()
          }}
          onBlur={() => {
            setEditing(false)
            run((v) => setAddress(v.getURL()))
          }}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              viewRef.current?.focus()
            }
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          title="Open in browser"
          disabled={!canOpenExternally(address)}
          onMouseDown={keepFocus}
          onClick={() => run((v) => window.cockpit.web.openExternal(v.getURL()))}
        >
          ↗
        </button>
      </form>
      {error && <div className="web-error">{error}</div>}
      <webview ref={viewRef} className="web-view" src={initialUrl} partition={WEB_PARTITION} />
    </div>
  )
}
