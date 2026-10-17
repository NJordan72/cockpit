import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { Action, CockpitConfig, SidebarSettings } from '@shared/config'
import { resolveTheme, themeVars, type Theme } from '@shared/theme'
import type { SecretPrompt, WidgetInfo } from '@shared/widgets'
import { Picker } from './components/Picker'
import { SecretPromptDialog } from './components/SecretPromptDialog'
import { TabBar } from './components/TabBar'
import { Workspace } from './components/Workspace'
import { actionFor, compileKeymap } from './keybindings'
import { findPane, makePane } from './layout/model'
import { activeTab, layoutReducer } from './layout/reducer'
import { terminals } from './terminal/registry'
import { xtermTheme } from './terminal/theme'
import { setWidgetTheme, startWidgetHost } from './widgets/host'
import { Sidebar } from './widgets/Sidebar'
import { visibleWidgets, withPlacements } from './widgets/sidebarModel'

interface PickerState {
  mode: 'tab' | 'row' | 'column'
  /** Pane being split; null for a new tab. */
  paneId: string | null
  currentDir: string | null
  presetId: string
}

const PICKER_TITLES: Record<PickerState['mode'], string> = {
  tab: 'New tab',
  row: 'Split right',
  column: 'Split down'
}

const SAVE_DELAY_MS = 150

export function App(): React.JSX.Element {
  const api = window.cockpit
  const [config, setConfig] = useState<CockpitConfig | null>(null)
  const [layout, dispatch] = useReducer(layoutReducer, { tabs: [], activeTabId: null })
  const [picker, setPicker] = useState<PickerState | null>(null)
  const [sidebarState, setSidebar] = useState<SidebarSettings | null>(null)
  const [widgets, setWidgets] = useState<WidgetInfo[]>([])
  const [prompts, setPrompts] = useState<SecretPrompt[]>([])
  const [windowVisible, setWindowVisible] = useState(() => document.visibilityState === 'visible')
  const loaded = useRef(false)

  // New widgets get a placement, so config.json lists every installed widget.
  const sidebar = useMemo(
    () => (sidebarState ? withPlacements(sidebarState, widgets) : null),
    [sidebarState, widgets]
  )
  // A hidden widget's prompt waits until the widget is shown.
  const prompt = useMemo(() => {
    const shown = sidebar ? visibleWidgets(sidebar, widgets, windowVisible) : new Set<string>()
    return prompts.find((p) => shown.has(p.widgetId)) ?? null
  }, [sidebar, widgets, windowVisible, prompts])

  const layoutRef = useRef(layout)
  const pickerRef = useRef(picker)
  const promptRef = useRef(prompt)
  useEffect(() => {
    layoutRef.current = layout
    pickerRef.current = picker
    promptRef.current = prompt
  })

  // Load config and restore the saved layout (or open one shell tab).
  useEffect(() => {
    let cancelled = false
    void api.config.get().then((c) => {
      if (cancelled) return
      setConfig(c)
      setSidebar(c.sidebar)
      if (c.layout.tabs.length > 0) dispatch({ type: 'replace', layout: c.layout })
      else dispatch({ type: 'newTab', pane: makePane('shell', '~') })
      loaded.current = true
    })
    // Only hand edits arrive here; they may rearrange the sidebar.
    const off = api.config.onChange((c) => {
      setConfig(c)
      setSidebar(c.sidebar)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [api])

  useEffect(() => {
    startWidgetHost()
    let cancelled = false
    let pushed = false
    const offChange = api.widgets.onChange((list) => {
      pushed = true
      setWidgets(list)
    })
    // A change pushed while this is in flight is newer than its answer.
    void api.widgets.list().then((list) => {
      if (!cancelled && !pushed) setWidgets(list)
    })
    const offPrompt = api.widgets.onSecretPrompt((p) => {
      setPrompts((ps) => [...ps, p])
    })
    const onVisibility = (): void => {
      setWindowVisible(document.visibilityState === 'visible')
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      offChange()
      offPrompt()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [api])

  useEffect(() => {
    if (!sidebar) return
    const t = setTimeout(() => {
      api.config.saveSidebar(sidebar)
    }, SAVE_DELAY_MS)
    return () => {
      clearTimeout(t)
    }
  }, [api, sidebar])

  // Keyed by value, so unrelated config edits don't restyle every terminal.
  const themeKey = config
    ? JSON.stringify(resolveTheme(config.theme, config.terminal.fontFamily))
    : null
  const theme = useMemo(() => (themeKey ? (JSON.parse(themeKey) as Theme) : null), [themeKey])
  const terminalTheme = useMemo(() => (theme ? xtermTheme(theme) : null), [theme])

  useEffect(() => {
    if (!theme) return
    const vars = themeVars(theme)
    for (const [name, value] of Object.entries(vars)) {
      document.documentElement.style.setProperty(name, value)
    }
    setWidgetTheme(vars)
  }, [theme])

  // Persist the layout shortly after it settles (divider drags fire per frame).
  useEffect(() => {
    if (!loaded.current) return
    const t = setTimeout(() => {
      api.config.saveLayout(layout)
    }, SAVE_DELAY_MS)
    return () => {
      clearTimeout(t)
    }
  }, [api, layout])

  const keymap = useMemo(() => {
    if (!config) return []
    const { keymap, invalid } = compileKeymap(config.keybindings)
    if (invalid.length) console.warn('Ignoring keybindings that could not be parsed:', invalid)
    return keymap
  }, [config])

  const focusActiveTerminal = useCallback(() => {
    const tab = activeTab(layoutRef.current)
    if (tab) terminals.get(tab.activePaneId)?.focus()
  }, [])

  const openPicker = useCallback(
    async (mode: PickerState['mode']) => {
      const tab = activeTab(layoutRef.current)
      const pane = tab ? findPane(tab.root, tab.activePaneId) : null
      if (mode !== 'tab' && !pane) return
      const live = pane ? await api.pty.cwd(pane.id) : null
      setPicker({
        mode,
        paneId: pane?.id ?? null,
        currentDir: live ?? pane?.cwd ?? null,
        presetId: pane?.presetId ?? 'shell'
      })
    },
    [api]
  )

  const runAction = useCallback(
    (action: Action) => {
      const tab = activeTab(layoutRef.current)
      switch (action) {
        case 'newTab':
          void openPicker('tab')
          return
        case 'splitRight':
          void openPicker('row')
          return
        case 'splitDown':
          void openPicker('column')
          return
        case 'closePane':
          if (tab) dispatch({ type: 'closePane', paneId: tab.activePaneId })
          return
        case 'focusLeft':
          dispatch({ type: 'focusDirection', direction: 'left' })
          return
        case 'focusRight':
          dispatch({ type: 'focusDirection', direction: 'right' })
          return
        case 'focusUp':
          dispatch({ type: 'focusDirection', direction: 'up' })
          return
        case 'focusDown':
          dispatch({ type: 'focusDirection', direction: 'down' })
          return
        case 'nextTab':
          dispatch({ type: 'cycleTab', delta: 1 })
          return
        case 'prevTab':
          dispatch({ type: 'cycleTab', delta: -1 })
          return
        case 'toggleSidebar':
          setSidebar((sb) => sb && { ...sb, visible: !sb.visible })
          return
        default: {
          const n = /^goToTab(\d)$/.exec(action)?.[1]
          if (n) dispatch({ type: 'selectTabIndex', index: Number(n) - 1 })
        }
      }
    },
    [openPicker]
  )

  // App shortcuts run in the capture phase, before xterm sees the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (pickerRef.current || promptRef.current) return
      const action = actionFor(keymap, e)
      if (!action) return
      e.preventDefault()
      e.stopPropagation()
      if (!e.repeat || action.startsWith('focus') || action.endsWith('Tab')) runAction(action)
    }
    window.addEventListener('keydown', onKey, true)
    // Keys pressed while a widget has focus never reach this window; the
    // main process forwards Cmd chords instead.
    const offAppKey = api.onAppKey((key) => {
      if (pickerRef.current || promptRef.current) return
      const action = actionFor(keymap, key)
      if (action) runAction(action)
    })
    return () => {
      window.removeEventListener('keydown', onKey, true)
      offAppKey()
    }
  }, [api, keymap, runAction])

  const closePicker = useCallback(() => {
    setPicker(null)
    requestAnimationFrame(focusActiveTerminal)
  }, [focusActiveTerminal])

  const answerPrompt = useCallback(
    (prompt: SecretPrompt, value: string | null) => {
      api.widgets.answerSecret(prompt.promptId, value)
      setPrompts((ps) => ps.filter((p) => p.promptId !== prompt.promptId))
      requestAnimationFrame(focusActiveTerminal)
    },
    [api, focusActiveTerminal]
  )

  if (!config || !terminalTheme) return <div className="app" />

  return (
    <div className="app">
      <TabBar
        layout={layout}
        presets={config.presets}
        dispatch={dispatch}
        onNewTab={() => void openPicker('tab')}
        onCloseTab={(tabId) => dispatch({ type: 'closeTab', tabId })}
      />
      <div className="main">
        <Workspace
          layout={layout}
          presets={config.presets}
          settings={config.terminal}
          theme={terminalTheme}
          dispatch={dispatch}
        />
        {sidebar && widgets.length > 0 && (
          <Sidebar
            widgets={widgets}
            settings={sidebar}
            windowVisible={windowVisible}
            onChange={setSidebar}
          />
        )}
      </div>
      {picker && (
        <Picker
          title={PICKER_TITLES[picker.mode]}
          presets={config.presets}
          initialPresetId={picker.presetId}
          currentDir={picker.currentDir}
          onCancel={closePicker}
          onSubmit={(presetId, cwd) => {
            const pane = makePane(presetId, cwd)
            if (picker.mode === 'tab') dispatch({ type: 'newTab', pane })
            else if (picker.paneId)
              dispatch({ type: 'split', paneId: picker.paneId, direction: picker.mode, pane })
            setPicker(null)
          }}
        />
      )}
      {prompt && (
        <SecretPromptDialog
          key={prompt.promptId}
          prompt={prompt}
          onAnswer={(value) => answerPrompt(prompt, value)}
        />
      )}
    </div>
  )
}
