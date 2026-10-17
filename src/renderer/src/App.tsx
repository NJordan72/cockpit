import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type {
  Action,
  AppearanceSettings,
  CockpitConfig,
  Layout,
  SidebarSettings
} from '@shared/config'
import { resolveTheme, themeVars, type ResolvedTheme, type ThemeDefinition } from '@shared/theme'
import type { PaneSession } from '@shared/ipc'
import type { SecretPrompt, SessionStatus, WidgetInfo } from '@shared/widgets'
import { Launcher } from './components/Launcher'
import { Picker } from './components/Picker'
import { SecretPromptDialog } from './components/SecretPromptDialog'
import { TabBar } from './components/TabBar'
import { Workspace } from './components/Workspace'
import { KidsMode } from './kids/KidsMode'
import { actionFor, compileKeymap } from './keybindings'
import { findPane, makePane } from './layout/model'
import { activeTab, layoutReducer } from './layout/reducer'
import { terminals } from './terminal/registry'
import { applyTheme } from './theme'
import { setWidgetTheme, startWidgetHost } from './widgets/host'
import { Sidebar } from './widgets/Sidebar'
import { visibleWidgets, withPlacements } from './widgets/sidebarModel'

declare global {
  interface Window {
    /** For the e2e driver. */
    __cockpitSessions?: () => PaneSession[]
  }
}

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
  const [themes, setThemes] = useState<ThemeDefinition[] | null>(null)
  const [layout, dispatch] = useReducer(layoutReducer, { tabs: [], activeTabId: null })
  const [picker, setPicker] = useState<PickerState | null>(null)
  const [sidebarState, setSidebar] = useState<SidebarSettings | null>(null)
  const [widgets, setWidgets] = useState<WidgetInfo[]>([])
  const [prompts, setPrompts] = useState<SecretPrompt[]>([])
  const [windowVisible, setWindowVisible] = useState(() => document.visibilityState === 'visible')
  const [sessions, setSessions] = useState<PaneSession[]>([])
  /** The layout saved last time, until a project is launched or it is restored. */
  const [restorable, setRestorable] = useState<Layout | null>(null)
  const [kids, setKids] = useState(false)
  const loaded = useRef(false)
  const launcherInput = useRef<HTMLInputElement>(null)

  const statuses = useMemo(
    () => new Map<string, SessionStatus>(sessions.map((s) => [s.id, s.status])),
    [sessions]
  )

  // New widgets get a placement, so config.json lists every installed widget.
  const sidebar = useMemo(
    () => (sidebarState ? withPlacements(sidebarState, widgets) : null),
    [sidebarState, widgets]
  )
  // Kids mode covers the sidebar, so widgets count as hidden under it.
  const widgetsVisible = windowVisible && !kids
  // A hidden widget's prompt waits until the widget is shown.
  const prompt = useMemo(() => {
    const shown = sidebar ? visibleWidgets(sidebar, widgets, widgetsVisible) : new Set<string>()
    return prompts.find((p) => shown.has(p.widgetId)) ?? null
  }, [sidebar, widgets, widgetsVisible, prompts])

  const configRef = useRef(config)
  const layoutRef = useRef(layout)
  const pickerRef = useRef(picker)
  const promptRef = useRef(prompt)
  const sessionsRef = useRef(sessions)
  const kidsRef = useRef(kids)
  useEffect(() => {
    configRef.current = config
    layoutRef.current = layout
    pickerRef.current = picker
    promptRef.current = prompt
    sessionsRef.current = sessions
    kidsRef.current = kids
  })

  // Pane statuses from the main process, for the tab badges and the session list.
  useEffect(() => {
    let cancelled = false
    let pushed = false
    const off = api.sessions.onChange((list) => {
      pushed = true
      setSessions(list)
    })
    void api.sessions.list().then((list) => {
      if (!cancelled && !pushed) setSessions(list)
    })
    window.__cockpitSessions = () => sessionsRef.current
    return () => {
      cancelled = true
      off()
    }
  }, [api])

  // Load config. The app opens on the start screen, which offers the saved
  // layout for restoring; nothing is saved over it until the user picks.
  useEffect(() => {
    let cancelled = false
    void api.config.get().then((c) => {
      if (cancelled) return
      setConfig(c)
      setSidebar(c.sidebar)
      setRestorable(c.layout.tabs.length > 0 ? c.layout : null)
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
    let cancelled = false
    let pushed = false
    const off = api.themes.onChange((list) => {
      pushed = true
      setThemes(list)
    })
    void api.themes.list().then((list) => {
      if (!cancelled && !pushed) setThemes(list)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [api])

  const setAppearance = useCallback(
    (next: AppearanceSettings) => {
      setConfig((c) => c && { ...c, appearance: next })
      api.config.saveAppearance(next)
    },
    [api]
  )

  // The View menu asks; the chrome owns the appearance and saves it.
  useEffect(
    () =>
      api.config.onAppearanceCommand((command) => {
        const current = configRef.current?.appearance
        if (current) setAppearance({ ...current, theme: command.id })
      }),
    [api, setAppearance]
  )

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
  const themeKey =
    config && themes
      ? JSON.stringify(
          resolveTheme(
            themes,
            config.appearance.theme,
            config.appearance.overrides,
            config.terminal.fontFamily
          )
        )
      : null
  const resolved = useMemo(
    () => (themeKey ? (JSON.parse(themeKey) as ResolvedTheme) : null),
    [themeKey]
  )
  const theme = resolved?.tokens ?? null
  const terminalTheme = resolved?.terminal ?? null

  useEffect(() => {
    if (!resolved || !themes) return
    applyTheme(resolved, themes)
    setWidgetTheme(themeVars(resolved.tokens))
  }, [resolved, themes])

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

  /** Give the keyboard to the active terminal, or to the start screen when no tab is open. */
  const focusWorkspace = useCallback(() => {
    const tab = activeTab(layoutRef.current)
    if (tab) terminals.get(tab.activePaneId)?.focus()
    else launcherInput.current?.focus()
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
        case 'kidsMode':
          api.kids.set(true)
          return
        default: {
          const n = /^goToTab(\d)$/.exec(action)?.[1]
          if (n) dispatch({ type: 'selectTabIndex', index: Number(n) - 1 })
        }
      }
    },
    [api, openPicker]
  )

  // App shortcuts run in the capture phase, before xterm sees the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Kids mode takes every key itself; no shortcut may close or open anything.
      if (kidsRef.current || pickerRef.current || promptRef.current) return
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
      if (kidsRef.current || pickerRef.current || promptRef.current) return
      const action = actionFor(keymap, key)
      if (action) runAction(action)
    })
    return () => {
      window.removeEventListener('keydown', onKey, true)
      offAppKey()
    }
  }, [api, keymap, runAction])

  /** Show a pane and give it the keyboard (a notification or the session list asked). */
  const revealPane = useCallback((paneId: string) => {
    setPicker(null)
    dispatch({ type: 'focusPane', paneId })
    requestAnimationFrame(() => terminals.get(paneId)?.focus())
  }, [])

  useEffect(() => api.sessions.onFocusRequest(revealPane), [api, revealPane])

  // When the window comes back, Chromium can hand focus to the first button in
  // the page, where a stray Enter would close a tab. Give it to the terminal
  // (or the start screen) unless something that takes typing (the picker, a
  // prompt, a widget) has it.
  useEffect(() => {
    const onFocus = (): void => {
      requestAnimationFrame(() => {
        if (kidsRef.current || pickerRef.current || promptRef.current) return
        const el = document.activeElement
        if (!el || el === document.body || el.tagName === 'BUTTON') focusWorkspace()
      })
    }
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
    }
  }, [focusWorkspace])

  // Main owns kids mode (it also comes from the View menu and survives a reload).
  useEffect(() => {
    let cancelled = false
    let pushed = false
    const off = api.kids.onChange((active) => {
      pushed = true
      setKids(active)
      if (active) setPicker(null)
      else requestAnimationFrame(focusWorkspace)
    })
    void api.kids.active().then((active) => {
      if (!cancelled && !pushed) setKids(active)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [api, focusWorkspace])

  const closePicker = useCallback(() => {
    setPicker(null)
    requestAnimationFrame(focusWorkspace)
  }, [focusWorkspace])

  const launch = useCallback(
    (presetId: string, cwd: string) => {
      dispatch({ type: 'newTab', pane: makePane(presetId, cwd) })
      setRestorable(null)
      const launcher = { presetId }
      api.config.saveLauncher(launcher)
      setConfig((c) => c && { ...c, launcher })
    },
    [api]
  )

  const restore = useCallback(() => {
    if (restorable) dispatch({ type: 'replace', layout: restorable })
    setRestorable(null)
  }, [restorable])

  const answerPrompt = useCallback(
    (prompt: SecretPrompt, value: string | null) => {
      api.widgets.answerSecret(prompt.promptId, value)
      setPrompts((ps) => ps.filter((p) => p.promptId !== prompt.promptId))
      requestAnimationFrame(focusWorkspace)
    },
    [api, focusWorkspace]
  )

  if (!config || !terminalTheme) return <div className="app" />

  return (
    <div className="app">
      <TabBar
        layout={layout}
        presets={config.presets}
        statuses={statuses}
        dispatch={dispatch}
        onNewTab={() => void openPicker('tab')}
        onCloseTab={(tabId) => dispatch({ type: 'closeTab', tabId })}
      />
      <div className="main">
        {layout.tabs.length > 0 ? (
          <Workspace
            layout={layout}
            presets={config.presets}
            settings={config.terminal}
            theme={terminalTheme}
            dispatch={dispatch}
          />
        ) : (
          <Launcher
            presets={config.presets}
            initialPresetId={config.launcher.presetId}
            projectsDir={config.projectsDir}
            restoreTabs={restorable?.tabs.length ?? 0}
            inputRef={launcherInput}
            onLaunch={launch}
            onRestore={restore}
          />
        )}
        {sidebar && (
          <Sidebar
            widgets={widgets}
            sessions={sessions}
            onSelectSession={revealPane}
            settings={sidebar}
            windowVisible={widgetsVisible}
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
            setRestorable(null)
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
      {kids && theme && (
        <KidsMode
          settings={config.kids}
          terminal={config.terminal}
          theme={theme}
          xtermTheme={terminalTheme}
          onExit={() => api.kids.set(false)}
        />
      )}
    </div>
  )
}
