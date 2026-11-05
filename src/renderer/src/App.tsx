import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  activeLayout,
  type Action,
  type AppearanceSettings,
  type CockpitConfig,
  type Layout,
  type PaneNode,
  type Tab,
  type WindowView
} from '@shared/config'
import {
  edges,
  hasTerminals,
  panels,
  placeWidgets,
  updateNode,
  visiblePanels,
  type FrameNode,
  type FramePanel,
  type FrameState
} from '@shared/frame'
import { builtInLayout, layoutChoices } from '@shared/layouts'
import { resolveTheme, themeVars, type ResolvedTheme, type ThemeDefinition } from '@shared/theme'
import type { BashCommand } from '@shared/activity'
import type { AppearanceCommand, PaneSession, WindowInfo } from '@shared/ipc'
import type { SecretPrompt, SessionStatus, WidgetInfo } from '@shared/widgets'
import { ActivityPanel } from './activity/ActivityPanel'
import { newSessionTarget } from './agentSessions'
import { Launcher } from './components/Launcher'
import { Picker } from './components/Picker'
import { SaveCommandDialog } from './components/SaveCommandDialog'
import { SecretPromptDialog } from './components/SecretPromptDialog'
import { SessionList } from './components/SessionList'
import { TabBar } from './components/TabBar'
import { Toolbar } from './components/Toolbar'
import { Workspace } from './components/Workspace'
import { Clock } from './frame/Clock'
import { FrameView, type PanelPlace } from './frame/FrameView'
import { ImagePanel } from './frame/ImagePanel'
import { slotName } from './frame/layout'
import { Monitor } from './frame/Monitor'
import { KidsMode, type KidsStatus } from './kids/KidsMode'
import { actionFor, compileKeymap } from './keybindings'
import { findPane, makePane, makeWebPane } from './layout/model'
import { CommandsPanel } from './panels/CommandsPanel'
import { PrPanel, type RunWhere } from './panels/PrPanel'
import { activeTab, layoutReducer } from './layout/reducer'
import { shownTabs, tabDirs, tabFolders } from './layout/tabs'
import { terminals } from './terminal/registry'
import { queueRun } from './terminal/run'
import { applyTheme } from './theme'
import { OpenUrlDialog, type OpenWhere } from './web/OpenUrlDialog'
import { webPanes } from './web/registry'
import { setWidgetTheme, startWidgetHost } from './widgets/host'
import { WidgetFrame } from './widgets/WidgetFrame'

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

const tabIds = (tabs: readonly Tab[]): string[] => tabs.map((t) => t.id)

/** Actions a window without terminals still runs itself; it forwards the rest. */
const OWN_ACTIONS: readonly Action[] = ['toggleSidebar', 'kidsMode']

/** Give a pane the keyboard, whether it's a terminal or a web page. */
function focusPane(paneId: string): void {
  const term = terminals.get(paneId)
  if (term) term.focus()
  else webPanes.get(paneId)?.focus()
}

export function App(): React.JSX.Element {
  const api = window.cockpit
  const [config, setConfig] = useState<CockpitConfig | null>(null)
  /** Which window this is, and what main says about it. */
  const [windowInfo, setWindowInfo] = useState<WindowInfo | null>(null)
  /** This window's layout and Cmd+B state; the appearance is shared by all windows. */
  const [view, setView] = useState<WindowView | null>(null)
  const [themes, setThemes] = useState<ThemeDefinition[] | null>(null)
  const [layout, dispatch] = useReducer(layoutReducer, { tabs: [], activeTabId: null })
  const [picker, setPicker] = useState<PickerState | null>(null)
  const [widgets, setWidgets] = useState<WidgetInfo[]>([])
  /** Heights reported by content-sized widgets. */
  const [contentHeights, setContentHeights] = useState<Record<string, number>>({})
  /** Bumped to reload a widget. */
  const [reloads, setReloads] = useState<Record<string, number>>({})
  const [imagesRevision, setImagesRevision] = useState(0)
  const [prompts, setPrompts] = useState<SecretPrompt[]>([])
  const [windowVisible, setWindowVisible] = useState(() => document.visibilityState === 'visible')
  const [sessions, setSessions] = useState<PaneSession[]>([])
  /** The layout saved last time, until a project is launched or it is restored. */
  const [restorable, setRestorable] = useState<Layout | null>(null)
  const [kids, setKids] = useState(false)
  const [kidsStatus, setKidsStatus] = useState<KidsStatus>('idle')
  /** The prompt being saved as a command, and the pane it came from. */
  const [saving, setSaving] = useState<{ prompt: string; paneId: string | null } | null>(null)
  /** Bumped when a command is saved, so the Commands panel reads its list again. */
  const [commandsRevision, setCommandsRevision] = useState(0)
  /** The Open web page dialog is up. */
  const [openingUrl, setOpeningUrl] = useState(false)
  const loaded = useRef(false)
  /** The appearance main has on disk, as JSON, so it isn't saved back to it. */
  const savedAppearance = useRef<string | null>(null)
  /** The same for this window's view. */
  const savedView = useRef<string | null>(null)
  const launcherInput = useRef<HTMLInputElement>(null)

  const statuses = useMemo(
    () => new Map<string, SessionStatus>(sessions.map((s) => [s.id, s.status])),
    [sessions]
  )

  const appearance = config?.appearance ?? null
  // A widget runs in one window only; main says which ones are this window's.
  const here = useMemo(() => new Set(windowInfo?.widgets ?? []), [windowInfo])
  const widgetMap = useMemo(
    () => new Map(widgets.filter((w) => here.has(w.id)).map((w) => [w.id, w])),
    [widgets, here]
  )
  // This window's widgets that its layout doesn't place go into its widget group.
  const tree = useMemo(
    () =>
      appearance && view
        ? placeWidgets(activeLayout(appearance, view.layout), [...widgetMap.keys()])
        : null,
    [appearance, view, widgetMap]
  )
  /** A window of panels only passes pane actions to the one with terminals. */
  const terminals = tree ? hasTerminals(tree) : true
  // The pane the user works in, in whichever window; Activity and the other
  // panels follow it.
  const focused = sessions.find((s) => s.focused) ?? null
  const hasFocus = focused !== null
  // Panels with nothing to show take no room.
  const frameState = useMemo<FrameState>(() => {
    const absent = new Set<string>()
    for (const p of tree ? panels(tree) : []) {
      if (p.panel === 'activity' && !hasFocus) absent.add(p.id)
      if (p.panel === 'widget' && p.widget && !widgetMap.has(p.widget)) absent.add(p.id)
    }
    // Cmd+B keeps the terminals; a window without them has nothing to keep.
    return { absent, panelsHidden: terminals && (view?.panelsHidden ?? false) }
  }, [tree, hasFocus, widgetMap, terminals, view?.panelsHidden])
  const visible = useMemo(
    () => (tree ? visiblePanels(tree, frameState) : new Set<string>()),
    [tree, frameState]
  )
  const frameEdges = useMemo(() => (tree ? edges(tree, frameState) : new Map()), [tree, frameState])
  // Widgets whose panel is on screen.
  const shownWidgets = useMemo(
    () =>
      new Set(
        (tree ? panels(tree) : []).flatMap((p) => (p.widget && visible.has(p.id) ? [p.widget] : []))
      ),
    [tree, visible]
  )
  // A hidden widget's prompt waits until the widget is shown. Kids mode leaves
  // widgets on screen, but their prompts wait until it ends.
  const prompt = useMemo(
    () =>
      windowVisible && !kids ? (prompts.find((p) => shownWidgets.has(p.widgetId)) ?? null) : null,
    [windowVisible, kids, shownWidgets, prompts]
  )
  const workspaceShown = (tree ? panels(tree) : []).some(
    (p) => p.panel === 'workspace' && visible.has(p.id)
  )
  const monitorOn =
    windowVisible &&
    (tree ? panels(tree) : []).some((p) => p.panel === 'monitor' && visible.has(p.id))

  const projectsDir = config?.projectsDir ?? '~/dev'
  const hiddenDirs = view?.hiddenDirs
  // The tabs the tab bar shows; the tab shortcuts go through these only.
  const shown = useMemo(
    () => shownTabs(layout, hiddenDirs ?? [], projectsDir),
    [layout, hiddenDirs, projectsDir]
  )
  const folders = useMemo(() => tabFolders(layout, projectsDir), [layout, projectsDir])

  const configRef = useRef(config)
  const layoutRef = useRef(layout)
  const shownRef = useRef(shown)
  const pickerRef = useRef(picker)
  const promptRef = useRef(prompt)
  const savingRef = useRef(saving)
  const sessionsRef = useRef(sessions)
  const kidsRef = useRef(kids)
  const openingUrlRef = useRef(openingUrl)
  useEffect(() => {
    configRef.current = config
    layoutRef.current = layout
    shownRef.current = shown
    pickerRef.current = picker
    promptRef.current = prompt
    savingRef.current = saving
    sessionsRef.current = sessions
    kidsRef.current = kids
    openingUrlRef.current = openingUrl
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

  // Load config. The window opens on the start screen, which offers its saved
  // tabs for restoring; nothing is saved over them until the user picks.
  useEffect(() => {
    let cancelled = false
    let id: string | null = null
    /** This window's layout from a config main sent, or null if it has none for it. */
    const takeView = (c: CockpitConfig): void => {
      const mine = c.windows.find((w) => w.id === id)
      if (!mine) return
      const next: WindowView = {
        layout: mine.layout,
        panelsHidden: mine.panelsHidden,
        hiddenDirs: mine.hiddenDirs
      }
      savedView.current = JSON.stringify(next)
      setView(next)
    }
    void Promise.all([api.config.get(), api.window.info()]).then(([c, info]) => {
      if (cancelled) return
      id = info.id
      setWindowInfo(info)
      savedAppearance.current = JSON.stringify(c.appearance)
      setConfig(c)
      takeView(c)
      const mine = c.windows.find((w) => w.id === info.id)
      setRestorable(mine && mine.tabs.length > 0 ? mine : null)
      loaded.current = true
    })
    // Only hand edits arrive here, the appearance among them. Saving that back
    // would rewrite the user's file a moment after they saved it.
    const off = api.config.onChange((c) => {
      savedAppearance.current = JSON.stringify(c.appearance)
      setConfig(c)
      takeView(c)
    })
    // Another window changed the appearance they share.
    const offAppearance = api.config.onAppearanceChange((a) => {
      savedAppearance.current = JSON.stringify(a)
      setConfig((c) => c && { ...c, appearance: a })
    })
    const offWindow = api.window.onChange(setWindowInfo)
    return () => {
      cancelled = true
      off()
      offAppearance()
      offWindow()
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

  useEffect(() => api.images.onChange(setImagesRevision), [api])

  useEffect(() => {
    api.system.watch(monitorOn)
  }, [api, monitorOn])

  const updateAppearance = useCallback((fn: (a: AppearanceSettings) => AppearanceSettings) => {
    setConfig((c) => c && { ...c, appearance: fn(c.appearance) })
  }, [])

  const updateView = useCallback((fn: (v: WindowView) => WindowView) => {
    setView((v) => v && fn(v))
  }, [])

  // Opening a tab in a hidden folder unhides that folder. Hidden folders with
  // no tabs left are dropped, so they can't hide a tab opened there later. The
  // start screen has no tabs, so the saved filter is kept until a restore.
  const tabsBefore = useRef(new Set<string>())
  useEffect(() => {
    const added = layout.tabs.filter((t) => !tabsBefore.current.has(t.id))
    tabsBefore.current = new Set(tabIds(layout.tabs))
    if (!hiddenDirs?.length || layout.tabs.length === 0) return
    const live = new Set(tabFolders(layout, projectsDir).map((f) => f.dir))
    // A restore adds every tab at once; a new tab comes alone.
    const opened = added.length === 1 && added[0] ? tabDirs(added[0], projectsDir) : []
    const next = hiddenDirs.filter((d) => live.has(d) && !opened.includes(d))
    if (next.length !== hiddenDirs.length) updateView((v) => ({ ...v, hiddenDirs: next }))
  }, [layout, hiddenDirs, projectsDir, updateView])

  // This window's view, saved the same way.
  useEffect(() => {
    if (!view) return
    const json = JSON.stringify(view)
    if (json === savedView.current) return
    const t = setTimeout(() => {
      savedView.current = json
      api.window.save(view)
    }, SAVE_DELAY_MS)
    return () => {
      clearTimeout(t)
    }
  }, [api, view])

  // The chrome owns the appearance. Save it shortly after it settles (divider
  // drags change it on every frame); a hand edit comes back here unchanged.
  useEffect(() => {
    if (!appearance) return
    const json = JSON.stringify(appearance)
    if (json === savedAppearance.current) return
    const t = setTimeout(() => {
      savedAppearance.current = json
      api.config.saveAppearance(appearance)
    }, SAVE_DELAY_MS)
    return () => {
      clearTimeout(t)
    }
  }, [api, appearance])

  /** A change to the layout in use. Saved as that layout's own copy. */
  const layoutId = view?.layout ?? null
  const setTree = useCallback(
    (next: FrameNode) => {
      if (layoutId === null) return
      updateAppearance((a) => ({ ...a, layouts: { ...a.layouts, [layoutId]: next } }))
    },
    [updateAppearance, layoutId]
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
    // Answered here or in another window.
    const offDone = api.widgets.onSecretDone((promptId) => {
      setPrompts((ps) => ps.filter((p) => p.promptId !== promptId))
    })
    const onVisibility = (): void => {
      setWindowVisible(document.visibilityState === 'visible')
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      offChange()
      offPrompt()
      offDone()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [api])

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
    if (tab) focusPane(tab.activePaneId)
    else launcherInput.current?.focus()
  }, [])

  /**
   * Sets the hidden folders. When they hide the active tab, the first tab
   * still shown becomes active, and that tab's terminal takes the keyboard by
   * itself. Calling focusWorkspace here would focus the old pane, which makes
   * the old tab active again.
   */
  const setHiddenDirs = useCallback(
    (dirs: string[]) => {
      updateView((v) => ({ ...v, hiddenDirs: dirs }))
      const l = layoutRef.current
      const left = shownTabs({ ...l, activeTabId: null }, dirs, projectsDir)
      const first = left[0]
      if (first && !left.some((t) => t.id === l.activeTabId)) {
        dispatch({ type: 'selectTab', tabId: first.id })
      } else requestAnimationFrame(focusWorkspace)
    },
    [updateView, projectsDir, focusWorkspace]
  )

  const runAppearance = useCallback(
    (command: AppearanceCommand) => {
      switch (command.type) {
        case 'theme':
          updateAppearance((a) => ({ ...a, theme: command.id }))
          return
        case 'layout':
          updateView((v) => ({ ...v, layout: command.id }))
          break
        case 'resetLayout': {
          // A layout written by hand has no built-in version to go back to.
          const id = layoutId
          if (id === null || !builtInLayout(id)) break
          updateAppearance((a) => ({
            ...a,
            layouts: Object.fromEntries(Object.entries(a.layouts).filter(([name]) => name !== id))
          }))
          break
        }
        case 'togglePanels':
          updateView((v) => ({ ...v, panelsHidden: !v.panelsHidden }))
          break
      }
      // A panel that had the keyboard may be gone.
      requestAnimationFrame(focusWorkspace)
    },
    [updateAppearance, updateView, layoutId, focusWorkspace]
  )

  // The View menu asks; the chrome carries it out.
  useEffect(() => api.config.onAppearanceCommand(runAppearance), [api, runAppearance])

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

  /**
   * A plain terminal: a new tab running the first preset with no command (a
   * login shell), in the directory the focused pane is in now.
   */
  const openShell = useCallback(async () => {
    const preset = configRef.current?.presets.find((p) => !p.command)
    if (!preset) return
    const tab = activeTab(layoutRef.current)
    const pane = tab ? findPane(tab.root, tab.activePaneId) : null
    const live = pane ? await api.pty.cwd(pane.id) : null
    setPicker(null)
    setRestorable(null)
    dispatch({ type: 'newTab', pane: makePane(preset.id, live ?? pane?.cwd ?? preset.cwd) })
  }, [api])

  /**
   * A new shell tab that runs a command from the Activity log, in the
   * directory it ran in there. If that directory is gone, the pane says so
   * instead of running it somewhere else.
   */
  const runCommand = useCallback((command: BashCommand) => {
    const preset = configRef.current?.presets.find((p) => !p.command)
    if (!preset) return
    const tab = activeTab(layoutRef.current)
    const from = tab ? findPane(tab.root, tab.activePaneId) : null
    const pane = makePane(preset.id, command.cwd ?? from?.cwd ?? preset.cwd)
    queueRun(pane.id, { text: command.text, strictCwd: command.cwd !== null })
    setPicker(null)
    setRestorable(null)
    dispatch({ type: 'newTab', pane })
  }, [])

  const runAction = useCallback(
    (action: Action) => {
      if (!terminals && !OWN_ACTIONS.includes(action)) {
        api.window.forward(action)
        return
      }
      const tab = activeTab(layoutRef.current)
      switch (action) {
        case 'newTab':
          void openPicker('tab')
          return
        case 'newShell':
          void openShell()
          return
        case 'openUrl':
          setPicker(null)
          setOpeningUrl(true)
          return
        case 'reloadPage':
          if (tab) webPanes.get(tab.activePaneId)?.reload()
          return
        case 'splitRight':
          void openPicker('row')
          return
        case 'splitDown':
          void openPicker('column')
          return
        case 'closePane':
          if (tab)
            dispatch({
              type: 'closePane',
              paneId: tab.activePaneId,
              shown: tabIds(shownRef.current)
            })
          return
        case 'clearPane':
          if (tab) dispatch({ type: 'clearPane', paneId: tab.activePaneId })
          return
        case 'resumePane':
          if (tab) dispatch({ type: 'clearPane', paneId: tab.activePaneId, resume: true })
          return
        case 'openEditor':
          if (tab) api.editor.openProject(tab.activePaneId)
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
          dispatch({ type: 'cycleTab', delta: 1, shown: tabIds(shownRef.current) })
          return
        case 'prevTab':
          dispatch({ type: 'cycleTab', delta: -1, shown: tabIds(shownRef.current) })
          return
        case 'toggleSidebar':
          runAppearance({ type: 'togglePanels' })
          return
        case 'kidsMode':
          api.kids.set(true)
          return
        default: {
          const n = /^goToTab(\d)$/.exec(action)?.[1]
          if (n)
            dispatch({
              type: 'selectTabIndex',
              index: Number(n) - 1,
              shown: tabIds(shownRef.current)
            })
        }
      }
    },
    [api, terminals, openPicker, openShell, runAppearance]
  )

  // A window without terminals passed this one an action.
  useEffect(() => api.window.onAction(runAction), [api, runAction])

  // App shortcuts run in the capture phase, before xterm sees the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Kids mode takes every key itself; no shortcut may close or open anything.
      if (
        kidsRef.current ||
        pickerRef.current ||
        promptRef.current ||
        savingRef.current ||
        openingUrlRef.current
      )
        return
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
      if (
        kidsRef.current ||
        pickerRef.current ||
        promptRef.current ||
        savingRef.current ||
        openingUrlRef.current
      )
        return
      const action = actionFor(keymap, key)
      if (action) runAction(action)
    })
    return () => {
      window.removeEventListener('keydown', onKey, true)
      offAppKey()
    }
  }, [api, keymap, runAction])

  /** Show a pane of this window and give it the keyboard (a notification or main asked). */
  const showPane = useCallback((paneId: string) => {
    setPicker(null)
    dispatch({ type: 'focusPane', paneId })
    requestAnimationFrame(() => focusPane(paneId))
  }, [])

  useEffect(() => api.sessions.onFocusRequest(showPane), [api, showPane])

  /** Show a pane (the session list asked); main brings forward another window's. */
  const revealPane = useCallback(
    (paneId: string) => {
      const mine = layoutRef.current.tabs.some((t) => findPane(t.root, paneId))
      if (mine) showPane(paneId)
      else api.sessions.reveal(paneId)
    },
    [api, showPane]
  )

  // When the window comes back, Chromium can hand focus to the first button in
  // the page, where a stray Enter would close a tab. Give it to the terminal
  // (or the start screen) unless something that takes typing (the picker, a
  // prompt, a widget) has it.
  useEffect(() => {
    const onFocus = (): void => {
      requestAnimationFrame(() => {
        if (
          kidsRef.current ||
          pickerRef.current ||
          promptRef.current ||
          savingRef.current ||
          openingUrlRef.current
        )
          return
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
      if (active) {
        // Kids mode leaves the rest of the window on screen, where these
        // would sit inert until it ends.
        setPicker(null)
        setOpeningUrl(false)
        setSaving(null)
      } else requestAnimationFrame(focusWorkspace)
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

  /** A new tab running an agent that starts with `prompt`. */
  const openSession = useCallback(
    (prompt: string) => {
      const target = config && newSessionTarget(config.presets, focused)
      if (!target) return
      setPicker(null)
      setRestorable(null)
      dispatch({ type: 'newTab', pane: { ...makePane(target.presetId, target.cwd), prompt } })
    },
    [config, focused]
  )

  /** Types `prompt` into a pane's agent and shows that pane. */
  const sendPrompt = useCallback(
    (paneId: string, prompt: string) => {
      void api.sessions.send(paneId, prompt).then((ok) => {
        if (ok) revealPane(paneId)
      })
    },
    [api, revealPane]
  )

  useEffect(() => api.sessions.onOpenRequest((req) => openSession(req.prompt)), [api, openSession])

  const runPrompt = useCallback(
    (prompt: string, where: RunWhere) => {
      if (where === 'here' && focused?.agent) sendPrompt(focused.id, prompt)
      else openSession(prompt)
    },
    [focused, sendPrompt, openSession]
  )

  const savePrompt = useCallback(
    (prompt: string) => setSaving({ prompt, paneId: focused?.id ?? null }),
    [focused]
  )

  /** A web page in a new tab, or beside the focused pane. */
  const openUrl = useCallback(
    (url: string, where: OpenWhere) => {
      setOpeningUrl(false)
      setRestorable(null)
      const tab = activeTab(layoutRef.current)
      const pane = makeWebPane(url, focused?.cwd ?? '~')
      if (where === 'row' && tab) {
        dispatch({ type: 'split', paneId: tab.activePaneId, direction: 'row', pane })
      } else {
        dispatch({ type: 'newTab', pane })
      }
    },
    [focused]
  )

  /** Where the picker was asked to put a new pane: a new tab, or split beside a pane. */
  const placePicked = useCallback((picked: PickerState, pane: PaneNode) => {
    setRestorable(null)
    if (picked.mode === 'tab') dispatch({ type: 'newTab', pane })
    else if (picked.paneId)
      dispatch({ type: 'split', paneId: picked.paneId, direction: picked.mode, pane })
    setPicker(null)
  }, [])

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

  const setContentHeight = useCallback((id: string, height: number) => {
    setContentHeights((h) => (h[id] === height ? h : { ...h, [id]: height }))
  }, [])

  const reloadWidget = useCallback((id: string) => {
    setReloads((r) => ({ ...r, [id]: (r[id] ?? 0) + 1 }))
  }, [])

  // The theme and the config arrive together before anything shows; after
  // that neither goes back to null, so the terminals are never unmounted.
  if (!config || !terminalTheme || !tree || !view || !windowInfo || !resolved) {
    return <div className="app" />
  }

  // The toolbar names this window's own pane; a window of panels names the
  // one the user works in.
  const ownTab = activeTab(layout)
  const toolbarPane = terminals
    ? (sessions.find((s) => s.id === ownTab?.activePaneId) ?? null)
    : focused

  const renderPanel = (p: FramePanel, place: PanelPlace): React.ReactNode => {
    switch (p.panel) {
      case 'tabbar':
        return (
          <TabBar
            layout={layout}
            shown={shown}
            folders={folders}
            hiddenDirs={view.hiddenDirs}
            projectsDir={projectsDir}
            presets={config.presets}
            statuses={statuses}
            kids={
              kids
                ? {
                    label: `${config.kids.name || 'Kids'} · work`,
                    status: kidsStatus,
                    exitWord: config.kids.exitWord
                  }
                : null
            }
            dispatch={dispatch}
            onNewTab={() => void openPicker('tab')}
            onCloseTab={(tabId) => dispatch({ type: 'closeTab', tabId, shown: tabIds(shown) })}
            onHiddenDirs={setHiddenDirs}
            onDone={() => requestAnimationFrame(focusWorkspace)}
          />
        )
      case 'sessions':
        return (
          <SessionList
            sessions={sessions}
            collapsed={place.collapsed}
            onToggle={place.canCollapse ? place.toggleCollapsed : undefined}
            onSelect={revealPane}
            onHidePanels={() => runAppearance({ type: 'togglePanels' })}
          />
        )
      case 'activity':
        return focused ? (
          <ActivityPanel
            session={focused}
            settings={{ tab: p.tab ?? 'log', collapsed: place.collapsed }}
            canCollapse={place.canCollapse}
            onChange={(next) => {
              setTree(
                updateNode(tree, p.id, (n) => {
                  if (n.type !== 'panel') return n
                  const updated: FramePanel = { ...n, tab: next.tab }
                  if (next.collapsed) updated.collapsed = true
                  else delete updated.collapsed
                  return updated
                })
              )
            }}
            visible={windowVisible && place.visible}
            onSavePrompt={savePrompt}
            onRunCommand={runCommand}
          />
        ) : null
      case 'prs':
        return (
          <PrPanel
            session={focused}
            visible={windowVisible && place.visible}
            actions={config.prActions}
            onRun={runPrompt}
          />
        )
      case 'commands':
        return (
          <CommandsPanel
            session={focused}
            visible={windowVisible && place.visible}
            revision={commandsRevision}
            onRun={runPrompt}
            onSave={savePrompt}
          />
        )
      case 'clock':
        return <Clock panel={p} visible={windowVisible && place.visible} />
      case 'image':
        return (
          <ImagePanel
            panel={p}
            themeId={resolved.id}
            revision={imagesRevision}
            sessions={sessions}
            visible={windowVisible && place.visible}
          />
        )
      case 'monitor':
        return <Monitor />
      default:
        return null
    }
  }

  // Widgets in a fixed order: React moves reordered siblings in the DOM, and
  // a moved iframe reloads.
  const floatingWidgets = [...widgetMap.values()]
    .filter((w) => w.manifest)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  return (
    <div className="app">
      {/* Kids mode draws over the terminals; the rest stays on screen but can't be used. */}
      <div className="app-main" inert={kids}>
        <div className="frame-root">
          <FrameView
            tree={tree}
            state={frameState}
            visible={visible}
            edges={frameEdges}
            widgets={widgetMap}
            sizing={{
              contentWidgets: new Set(
                widgets.filter((w) => w.manifest?.sizing === 'content').map((w) => w.id)
              ),
              state: frameState
            }}
            contentHeights={contentHeights}
            onChange={setTree}
            onReloadWidget={reloadWidget}
            renderPanel={renderPanel}
          />
          {/* Not positioned: the items' containing block must be .frame-root,
              the ancestor of the placeholders they anchor to. */}
          <div className="frame-floating">
            {/* Kept while a window of panels has tabs from before, so they live on. */}
            {(terminals || layout.tabs.length > 0) && (
              <div
                className="floating-item"
                style={{
                  ['--anchor' as string]: slotName('workspace'),
                  display: workspaceShown ? undefined : 'none'
                }}
              >
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
              </div>
            )}
            {floatingWidgets.map((w) =>
              w.manifest ? (
                <div
                  key={w.id}
                  className="floating-item"
                  style={{
                    ['--anchor' as string]: slotName(`w-${w.id}`),
                    display: shownWidgets.has(w.id) ? undefined : 'none'
                  }}
                >
                  <WidgetFrame
                    key={`${String(w.revision)}:${String(reloads[w.id] ?? 0)}`}
                    id={w.id}
                    manifest={w.manifest}
                    visible={windowVisible && shownWidgets.has(w.id)}
                    onSize={(h) => setContentHeight(w.id, h)}
                  />
                </div>
              ) : null
            )}
          </div>
        </div>
        <Toolbar
          focused={toolbarPane}
          keybindings={config.keybindings}
          layouts={layoutChoices(config.appearance)}
          layout={view.layout}
          panelsHidden={view.panelsHidden}
          active={windowVisible}
          onAction={runAction}
          onLayout={(id) => runAppearance({ type: 'layout', id })}
          windows={windowInfo.count}
          displays={windowInfo.displays}
          onWindows={(n) => api.window.setCount(n)}
        />
        {picker && (
          <Picker
            title={PICKER_TITLES[picker.mode]}
            presets={config.presets}
            initialPresetId={picker.presetId}
            currentDir={picker.currentDir}
            onCancel={closePicker}
            onSubmit={(presetId, cwd) => placePicked(picker, makePane(presetId, cwd))}
            onOpenPage={(url) => placePicked(picker, makeWebPane(url, picker.currentDir ?? '~'))}
          />
        )}
        {openingUrl && (
          <OpenUrlDialog
            canSplit={layout.tabs.length > 0}
            onOpen={openUrl}
            onCancel={() => {
              setOpeningUrl(false)
              requestAnimationFrame(focusWorkspace)
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
        {saving && (
          <SaveCommandDialog
            prompt={saving.prompt}
            paneId={saving.paneId}
            onClose={(saved) => {
              setSaving(null)
              if (saved) setCommandsRevision((r) => r + 1)
              requestAnimationFrame(focusWorkspace)
            }}
          />
        )}
      </div>
      {kids && theme && (
        <KidsMode
          settings={config.kids}
          terminal={config.terminal}
          theme={theme}
          xtermTheme={terminalTheme}
          onStatus={setKidsStatus}
          onExit={() => api.kids.set(false)}
        />
      )}
    </div>
  )
}
