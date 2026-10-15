import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { classifyKey } from './keys'
import { terminals } from './registry'
import { darkTheme, fontFamily } from './theme'

interface Props {
  id: string
  command?: string
  cwd?: string
}

export function TerminalPane({ id, command, cwd }: Props): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const api = window.cockpit

    const term = new Terminal({
      fontFamily,
      fontSize: 13,
      lineHeight: 1.1,
      cursorBlink: true,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: true,
      allowProposedApi: true,
      scrollback: 10_000,
      theme: darkTheme
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    const unicode = new Unicode11Addon()
    term.loadAddon(unicode)
    term.unicode.activeVersion = '11'
    term.loadAddon(new SearchAddon())
    term.loadAddon(
      new WebLinksAddon((_event, uri) => {
        // The main process routes http(s) window.open calls to the browser.
        window.open(uri, '_blank')
      })
    )

    term.open(host)
    terminals.set(id, term)

    // WebGL first; if it fails or the GPU context is lost, xterm falls back to
    // its DOM renderer once the addon is disposed.
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => {
        webgl.dispose()
      })
      term.loadAddon(webgl)
    } catch (err) {
      console.warn('WebGL renderer unavailable, using DOM renderer', err)
    }

    term.attachCustomKeyEventHandler((e) => {
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

    const offData = api.pty.onData(id, (data) => {
      term.write(data)
    })
    const offExit = api.pty.onExit(id, ({ exitCode, signal }) => {
      const how = signal ? `signal ${signal}` : `code ${exitCode}`
      term.write(`\r\n\x1b[2m[process exited with ${how}]\x1b[0m\r\n`)
    })
    const onInput = term.onData((data) => {
      api.pty.write(id, data)
    })
    const onBinary = term.onBinary((data) => {
      api.pty.write(id, data)
    })
    const onResize = term.onResize(({ cols, rows }) => {
      api.pty.resize(id, cols, rows)
    })

    fit.fit()
    void api.pty.create({ id, cols: term.cols, rows: term.rows, command, cwd })
    term.focus()

    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (host.clientWidth > 0 && host.clientHeight > 0) fit.fit()
      })
    })
    observer.observe(host)

    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      onInput.dispose()
      onBinary.dispose()
      onResize.dispose()
      offData()
      offExit()
      api.pty.kill(id)
      if (terminals.get(id) === term) terminals.delete(id)
      term.dispose()
    }
  }, [id, command, cwd])

  return <div className="terminal-pane" ref={hostRef} />
}
