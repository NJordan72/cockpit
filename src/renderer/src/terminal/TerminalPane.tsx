import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { terminalFontStack, type PaneNode, type TerminalSettings } from '@shared/config'
import type { PtyExitInfo } from '@shared/ipc'
import type { PaneLabel } from '@shared/widgets'
import { OutputAcks } from './acks'
import { classifyKey } from './keys'
import { LabelStrip } from './LabelStrip'
import { openHyperlink, pathLinkProvider } from './pathLinks'
import { terminals } from './registry'
import { runWhenReady, takeRun } from './run'

/** How long a pane is hidden before it gives up its WebGL context. */
const WEBGL_HIDDEN_MS = 30_000

interface Props {
  pane: PaneNode
  presetName: string
  settings: TerminalSettings
  theme: ITheme
  focused: boolean
  visible: boolean
  /** What widgets say about the pane, in a strip above the terminal. */
  labels?: readonly PaneLabel[]
  onFocus: () => void
  onStarted: (cwd: string) => void
}

export function TerminalPane({
  pane,
  presetName,
  settings,
  theme,
  focused,
  visible,
  labels,
  onFocus,
  onStarted
}: Props): React.JSX.Element {
  const { id } = pane
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const webglRef = useRef<WebglAddon | null>(null)
  const webglFailed = useRef(false)
  const [exit, setExit] = useState<PtyExitInfo | null>(null)
  const exitRef = useRef<PtyExitInfo | null>(null)

  // Values the long-lived terminal effect reads later without re-running.
  const spawnArgs = useRef({
    presetId: pane.presetId,
    cwd: pane.cwd,
    resume: pane.resume === true,
    prompt: pane.prompt,
    onFocus,
    onStarted
  })
  useLayoutEffect(() => {
    exitRef.current = exit
    spawnArgs.current = {
      presetId: pane.presetId,
      cwd: pane.cwd,
      resume: pane.resume === true,
      prompt: pane.prompt,
      onFocus,
      onStarted
    }
  })

  const startRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const api = window.cockpit

    const term = new Terminal({
      fontFamily: terminalFontStack(settings.fontFamily),
      fontSize: settings.fontSize,
      lineHeight: 1.1,
      cursorBlink: true,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: true,
      allowProposedApi: true,
      scrollback: settings.scrollback,
      theme,
      linkHandler: {
        activate: (_event, uri) => openHyperlink(id, uri),
        allowNonHttpProtocols: true
      }
    })
    termRef.current = term

    const fit = new FitAddon()
    term.loadAddon(fit)
    fitRef.current = fit
    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11'
    term.loadAddon(new SearchAddon())
    term.loadAddon(
      new WebLinksAddon((_event, uri) => {
        // The main process routes http(s) window.open calls to the browser.
        window.open(uri, '_blank')
      })
    )
    const pathLinks = term.registerLinkProvider(pathLinkProvider(term, id))

    term.open(host)
    terminals.set(id, term)

    let disposed = false
    // A command from the Activity log, for the first start only.
    let pending = takeRun(id)
    let typing: { dispose: () => void } | null = null
    const start = (): void => {
      setExit(null)
      fit.fit()
      const { presetId, cwd, resume, prompt } = spawnArgs.current
      const run = pending
      pending = undefined
      typing?.dispose()
      // Watching starts before the PTY does, so the shell's first output is seen.
      typing = run
        ? runWhenReady(term, run.text, () => {
            api.pty.write(id, '\r')
          })
        : null
      api.pty
        .create({
          id,
          cols: term.cols,
          rows: term.rows,
          presetId,
          cwd,
          resume,
          prompt,
          strictCwd: run?.strictCwd
        })
        .then((created) => {
          if (!disposed) spawnArgs.current.onStarted(created.cwd)
        })
        .catch((err: unknown) => {
          if (disposed) return
          typing?.dispose()
          term.write(`\r\n\x1b[31m[could not start: ${String(err)}]\x1b[0m\r\n`)
          setExit({ exitCode: -1 })
        })
    }
    startRef.current = () => {
      term.reset()
      start()
      term.focus()
    }

    term.attachCustomKeyEventHandler((e) => {
      if (exitRef.current) {
        // While exited, Enter restarts; everything else is ignored.
        if (e.type === 'keydown' && e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault()
          startRef.current()
        }
        return false
      }
      const action = classifyKey(e)
      switch (action.kind) {
        case 'pass':
          return true
        case 'ignore':
          return false
        case 'send':
          e.preventDefault()
          api.pty.write(id, action.data)
          return false
        case 'copy':
          e.preventDefault()
          if (term.hasSelection()) api.clipboard.writeText(term.getSelection())
          return false
        case 'paste':
          e.preventDefault()
          void api.clipboard.readText().then((text) => {
            if (text) term.paste(text)
          })
          return false
        case 'clear':
          e.preventDefault()
          term.clear()
          return false
      }
    })

    const acks = new OutputAcks((chars) => api.pty.ack(id, chars))
    const offData = api.pty.onData(id, (data) => {
      const parsed = acks.received(data.length, document.hidden)
      if (parsed) term.write(data, parsed)
      else term.write(data)
    })
    const onVisibility = (): void => {
      if (document.hidden) acks.releaseAll()
    }
    document.addEventListener('visibilitychange', onVisibility)
    const offExit = api.pty.onExit(id, (info) => {
      const how = info.signal ? `signal ${info.signal}` : `code ${info.exitCode}`
      term.write(`\r\n\x1b[2m[process exited with ${how}]\x1b[0m\r\n`)
      setExit(info)
    })
    const onInput = term.onData((data) => {
      if (!exitRef.current) api.pty.write(id, data)
    })
    const onBinary = term.onBinary((data) => {
      if (!exitRef.current) api.pty.write(id, data)
    })
    const onResize = term.onResize(({ cols, rows }) => {
      api.pty.resize(id, cols, rows)
    })
    const onFocusIn = (): void => {
      spawnArgs.current.onFocus()
    }
    term.textarea?.addEventListener('focus', onFocusIn)

    start()

    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        // Hidden tabs have zero size; fitting then would shrink the PTY to 1x1.
        if (host.clientWidth > 0 && host.clientHeight > 0) fit.fit()
      })
    })
    observer.observe(host)

    return () => {
      disposed = true
      typing?.dispose()
      observer.disconnect()
      cancelAnimationFrame(frame)
      term.textarea?.removeEventListener('focus', onFocusIn)
      onInput.dispose()
      onBinary.dispose()
      onResize.dispose()
      pathLinks.dispose()
      offData()
      offExit()
      document.removeEventListener('visibilitychange', onVisibility)
      api.pty.kill(id)
      if (terminals.get(id) === term) terminals.delete(id)
      termRef.current = null
      fitRef.current = null
      // Disposed along with the terminal.
      webglRef.current = null
      term.dispose()
    }
    // The terminal lives as long as the pane id; settings changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // WebGL while the pane is on screen. Chromium keeps only so many WebGL
  // contexts per page and drops the oldest past that, so a pane that has been
  // hidden a while gives its context back and draws with the DOM renderer
  // until it's shown again. If WebGL fails or the context is lost, xterm falls
  // back to the DOM renderer once the addon is disposed.
  useEffect(() => {
    const term = termRef.current
    if (!term) return undefined
    if (visible) {
      if (webglRef.current || webglFailed.current) return undefined
      try {
        const webgl = new WebglAddon()
        webgl.onContextLoss(() => {
          webgl.dispose()
          if (webglRef.current === webgl) webglRef.current = null
        })
        term.loadAddon(webgl)
        webglRef.current = webgl
      } catch (err) {
        webglFailed.current = true
        console.warn('WebGL renderer unavailable, using DOM renderer', err)
      }
      return undefined
    }
    const t = setTimeout(() => {
      webglRef.current?.dispose()
      webglRef.current = null
    }, WEBGL_HIDDEN_MS)
    return () => {
      clearTimeout(t)
    }
  }, [visible])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    const fontFamily = terminalFontStack(settings.fontFamily)
    if (term.options.fontFamily === fontFamily && term.options.fontSize === settings.fontSize)
      return
    term.options.fontFamily = fontFamily
    term.options.fontSize = settings.fontSize
    // New cell size means a new grid size; hidden panes refit when shown.
    if (visible) fitRef.current?.fit()
  }, [settings.fontFamily, settings.fontSize, visible])

  useEffect(() => {
    const term = termRef.current
    // Lowering it drops the oldest lines past the new limit.
    if (term && term.options.scrollback !== settings.scrollback) {
      term.options.scrollback = settings.scrollback
    }
  }, [settings.scrollback])

  useEffect(() => {
    const term = termRef.current
    if (term && term.options.theme !== theme) term.options.theme = theme
  }, [theme])

  useEffect(() => {
    if (focused && visible) termRef.current?.focus()
  }, [focused, visible])

  const restart = useCallback(() => {
    startRef.current()
  }, [])

  return (
    <div className={`terminal-pane${focused ? ' focused' : ''}`}>
      {/* The host shrinks to make room, and its resize observer fits the rows again. */}
      {labels && labels.length > 0 && <LabelStrip paneId={id} labels={labels} />}
      <div className="terminal-host" ref={hostRef} />
      {exit && (
        <div className="exit-bar">
          <span>
            {presetName} exited with{' '}
            {exit.signal ? `signal ${exit.signal}` : `code ${exit.exitCode}`}
          </span>
          <button type="button" tabIndex={-1} onClick={restart}>
            Restart <kbd>⏎</kbd>
          </button>
        </div>
      )}
    </div>
  )
}
