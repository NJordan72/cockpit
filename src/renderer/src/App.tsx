import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { Action, CockpitConfig } from '@shared/config'
import { Picker } from './components/Picker'
import { TabBar } from './components/TabBar'
import { Workspace } from './components/Workspace'
import { actionFor, compileKeymap } from './keybindings'
import { findPane, makePane } from './layout/model'
import { activeTab, layoutReducer } from './layout/reducer'
import { terminals } from './terminal/registry'

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
  const loaded = useRef(false)

  const layoutRef = useRef(layout)
  const pickerRef = useRef(picker)
  useEffect(() => {
    layoutRef.current = layout
    pickerRef.current = picker
  })

  // Load config and restore the saved layout (or open one shell tab).
  useEffect(() => {
    let cancelled = false
    void api.config.get().then((c) => {
      if (cancelled) return
      setConfig(c)
      if (c.layout.tabs.length > 0) dispatch({ type: 'replace', layout: c.layout })
      else dispatch({ type: 'newTab', pane: makePane('shell', '~') })
      loaded.current = true
    })
    const off = api.config.onChange(setConfig)
    return () => {
      cancelled = true
      off()
    }
  }, [api])

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
      if (pickerRef.current) return
      const action = actionFor(keymap, e)
      if (!action) return
      e.preventDefault()
      e.stopPropagation()
      if (!e.repeat || action.startsWith('focus') || action.endsWith('Tab')) runAction(action)
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
    }
  }, [keymap, runAction])

  const closePicker = useCallback(() => {
    setPicker(null)
    requestAnimationFrame(focusActiveTerminal)
  }, [focusActiveTerminal])

  if (!config) return <div className="app" />

  return (
    <div className="app">
      <TabBar
        layout={layout}
        presets={config.presets}
        dispatch={dispatch}
        onNewTab={() => void openPicker('tab')}
        onCloseTab={(tabId) => dispatch({ type: 'closeTab', tabId })}
      />
      <Workspace
        layout={layout}
        presets={config.presets}
        settings={config.terminal}
        dispatch={dispatch}
      />
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
    </div>
  )
}
