// The shape of ~/.cockpit/config.json, its defaults, and migration from older
// or hand-edited files. Pure so it can be unit tested.
import { isSafeThemeValue, THEME_KEYS, type ThemeOverrides } from './theme'

export const CONFIG_VERSION = 2

export interface Preset {
  id: string
  name: string
  /** Command run through the login shell. Omit for an interactive shell. */
  command?: string
  /** Default working directory. `~` is expanded by the main process. */
  cwd: string
}

export type Action =
  | 'newTab'
  | 'splitRight'
  | 'splitDown'
  | 'closePane'
  | 'focusLeft'
  | 'focusRight'
  | 'focusUp'
  | 'focusDown'
  | 'nextTab'
  | 'prevTab'
  | 'goToTab1'
  | 'goToTab2'
  | 'goToTab3'
  | 'goToTab4'
  | 'goToTab5'
  | 'goToTab6'
  | 'goToTab7'
  | 'goToTab8'
  | 'goToTab9'
  | 'toggleSidebar'
  | 'kidsMode'

export type Keybindings = Record<Action, string>

export interface PaneNode {
  type: 'pane'
  id: string
  presetId: string
  cwd: string
}

export interface SplitNode {
  type: 'split'
  id: string
  /** row: children side by side; column: stacked top to bottom. */
  direction: 'row' | 'column'
  children: LayoutNode[]
  /** Fractions that sum to 1, one per child. */
  sizes: number[]
}

export type LayoutNode = PaneNode | SplitNode

export interface Tab {
  id: string
  root: LayoutNode
  activePaneId: string
}

export interface Layout {
  tabs: Tab[]
  activeTabId: string | null
}

export interface TerminalSettings {
  fontFamily: string
  fontSize: number
}

export interface WidgetPlacement {
  id: string
  collapsed: boolean
  /** Share of the free height among expanded fill widgets (stack mode). */
  size: number
}

export type ActivityTab = 'log' | 'files' | 'agents' | 'git'

export const ACTIVITY_TABS: readonly ActivityTab[] = ['log', 'files', 'agents', 'git']

/** The Activity panel: what the focused pane's agent has been doing. */
export interface ActivitySettings {
  collapsed: boolean
  /** Height in pixels while widgets share the sidebar; with none, it fills it. */
  height: number
  tab: ActivityTab
}

export const ACTIVITY_MIN_HEIGHT = 96
export const ACTIVITY_MAX_HEIGHT = 2000

export interface SidebarSettings {
  visible: boolean
  /** Width in pixels. */
  width: number
  /** stack: all widgets one above the other. tabs: one at a time. */
  mode: 'stack' | 'tabs'
  /** The widget shown in tabs mode. */
  activeWidget: string | null
  /** The session list at the top of the sidebar is folded away. */
  sessionsCollapsed: boolean
  activity: ActivitySettings
  /** Order and state of widgets. Installed widgets missing here are appended. */
  widgets: WidgetPlacement[]
}

export interface RecentDir {
  /** Path with ~ for home. */
  path: string
  /** Preset of the last pane started there. Missing in entries from version 1. */
  presetId?: string
  /** When that pane started, in ms since the epoch; 0 if unknown. */
  at: number
}

export interface LauncherSettings {
  /** The agent the start screen launches with: the last one launched from it. */
  presetId: string
}

/**
 * Kids mode: a pretend terminal for a small child, where keys play music and
 * show big letters and characters. Pictures come from ~/.cockpit/kids/.
 */
export interface KidsSettings {
  /** Shown in the welcome box ("Welcome, Ava!"). Empty for a generic one. */
  name: string
  /** Typing this word, in lowercase letters, leaves kids mode. */
  exitWord: string
  /** 0 to 1. */
  volume: number
  /** songs: every key plays the next note of a nursery rhyme. notes: each key has its own note. */
  sound: 'songs' | 'notes'
  /** Say the letter after a pause ("B is for bear"). */
  speak: boolean
}

export interface CockpitConfig {
  version: number
  presets: Preset[]
  keybindings: Keybindings
  terminal: TerminalSettings
  /** Overrides for the colors and fonts in theme.ts. */
  theme: ThemeOverrides
  sidebar: SidebarSettings
  /** Directory the Cmd+T picker lists projects from. */
  projectsDir: string
  /** Most recently used working directories, newest first. */
  recentDirs: RecentDir[]
  launcher: LauncherSettings
  kids: KidsSettings
  layout: Layout
}

export const DEFAULT_PRESETS: Preset[] = [
  { id: 'shell', name: 'Shell', cwd: '~' },
  { id: 'claude', name: 'Claude Code', command: 'claude', cwd: '~/dev' },
  { id: 'codex', name: 'Codex', command: 'codex', cwd: '~/dev' }
]

export const DEFAULT_KEYBINDINGS: Keybindings = {
  newTab: 'Cmd+T',
  splitRight: 'Cmd+D',
  splitDown: 'Cmd+Shift+D',
  closePane: 'Cmd+W',
  focusLeft: 'Cmd+Alt+Left',
  focusRight: 'Cmd+Alt+Right',
  focusUp: 'Cmd+Alt+Up',
  focusDown: 'Cmd+Alt+Down',
  nextTab: 'Cmd+Shift+]',
  prevTab: 'Cmd+Shift+[',
  goToTab1: 'Cmd+1',
  goToTab2: 'Cmd+2',
  goToTab3: 'Cmd+3',
  goToTab4: 'Cmd+4',
  goToTab5: 'Cmd+5',
  goToTab6: 'Cmd+6',
  goToTab7: 'Cmd+7',
  goToTab8: 'Cmd+8',
  goToTab9: 'Cmd+9',
  toggleSidebar: 'Cmd+B',
  kidsMode: 'Cmd+Shift+K'
}

export const DEFAULT_TERMINAL: TerminalSettings = {
  fontFamily:
    '"0xProto Nerd Font Mono", "JetBrainsMono Nerd Font Mono", ui-monospace, Menlo, monospace',
  fontSize: 13
}

export const DEFAULT_KIDS: KidsSettings = {
  name: '',
  exitWord: 'grownup',
  volume: 0.6,
  sound: 'songs',
  speak: true
}

/** Long enough that a child mashing keys won't type it by chance. */
const EXIT_WORD = /^[a-z]{5,32}$/

export const SIDEBAR_MIN_WIDTH = 180
export const SIDEBAR_MAX_WIDTH = 900

export function defaultSidebar(): SidebarSettings {
  return {
    visible: true,
    width: 320,
    mode: 'stack',
    activeWidget: null,
    sessionsCollapsed: false,
    activity: { collapsed: false, height: 320, tab: 'log' },
    widgets: []
  }
}

export function defaultConfig(): CockpitConfig {
  return {
    version: CONFIG_VERSION,
    presets: DEFAULT_PRESETS.map((p) => ({ ...p })),
    keybindings: { ...DEFAULT_KEYBINDINGS },
    terminal: { ...DEFAULT_TERMINAL },
    theme: {},
    sidebar: defaultSidebar(),
    projectsDir: '~/dev',
    recentDirs: [],
    launcher: { presetId: 'claude' },
    kids: { ...DEFAULT_KIDS },
    layout: { tabs: [], activeTabId: null }
  }
}

const MAX_RECENT_DIRS = 20

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const nonEmpty = (v: unknown): v is string => isStr(v) && v.length > 0

function readPreset(v: unknown): Preset | null {
  if (!isObj(v) || !nonEmpty(v.id) || !nonEmpty(v.name)) return null
  const preset: Preset = { id: v.id, name: v.name, cwd: nonEmpty(v.cwd) ? v.cwd : '~' }
  if (nonEmpty(v.command)) preset.command = v.command
  return preset
}

function readNode(v: unknown, seen: Set<string>): LayoutNode | null {
  if (!isObj(v) || !nonEmpty(v.id) || seen.has(v.id)) return null
  seen.add(v.id)
  if (v.type === 'pane') {
    if (!nonEmpty(v.presetId)) return null
    return { type: 'pane', id: v.id, presetId: v.presetId, cwd: nonEmpty(v.cwd) ? v.cwd : '~' }
  }
  if (v.type === 'split') {
    if (v.direction !== 'row' && v.direction !== 'column') return null
    if (!Array.isArray(v.children)) return null
    const children = v.children
      .map((c) => readNode(c, seen))
      .filter((c): c is LayoutNode => c !== null)
    if (children.length === 0) return null
    if (children.length === 1) return children[0] ?? null
    return {
      type: 'split',
      id: v.id,
      direction: v.direction,
      children,
      sizes: normalizeSizes(v.sizes, children.length)
    }
  }
  return null
}

/** Sizes must be positive fractions, one per child, summing to 1. */
export function normalizeSizes(raw: unknown, count: number): number[] {
  const nums =
    Array.isArray(raw) && raw.length === count
      ? raw.map((n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0))
      : []
  const total = nums.reduce((a, b) => a + b, 0)
  if (nums.length !== count || total <= 0 || nums.some((n) => n === 0)) {
    return Array.from({ length: count }, () => 1 / count)
  }
  return nums.map((n) => n / total)
}

function firstPaneId(node: LayoutNode): string {
  if (node.type === 'pane') return node.id
  const first = node.children[0]
  return first ? firstPaneId(first) : node.id
}

export function paneIds(node: LayoutNode): string[] {
  return node.type === 'pane' ? [node.id] : node.children.flatMap(paneIds)
}

function readLayout(v: unknown, presetIds: Set<string>): Layout {
  const empty: Layout = { tabs: [], activeTabId: null }
  if (!isObj(v) || !Array.isArray(v.tabs)) return empty
  const seen = new Set<string>()
  const tabs: Tab[] = []
  for (const t of v.tabs) {
    if (!isObj(t) || !nonEmpty(t.id) || seen.has(t.id)) continue
    seen.add(t.id)
    const root = readNode(t.root, seen)
    if (!root) continue
    // Panes whose preset was deleted fall back to a shell.
    const fixPresets = (n: LayoutNode): LayoutNode =>
      n.type === 'pane'
        ? presetIds.has(n.presetId)
          ? n
          : { ...n, presetId: 'shell' }
        : { ...n, children: n.children.map(fixPresets) }
    const fixed = fixPresets(root)
    const ids = paneIds(fixed)
    const active =
      isStr(t.activePaneId) && ids.includes(t.activePaneId) ? t.activePaneId : firstPaneId(fixed)
    tabs.push({ id: t.id, root: fixed, activePaneId: active })
  }
  const activeTabId =
    isStr(v.activeTabId) && tabs.some((t) => t.id === v.activeTabId)
      ? v.activeTabId
      : (tabs[0]?.id ?? null)
  return { tabs, activeTabId }
}

export function readSidebar(v: unknown): SidebarSettings {
  const def = defaultSidebar()
  if (!isObj(v)) return def
  const width =
    typeof v.width === 'number' && Number.isFinite(v.width)
      ? Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, v.width)))
      : def.width
  const seen = new Set<string>()
  const widgets: WidgetPlacement[] = []
  if (Array.isArray(v.widgets)) {
    for (const w of v.widgets) {
      if (!isObj(w) || !nonEmpty(w.id) || seen.has(w.id)) continue
      seen.add(w.id)
      const size = typeof w.size === 'number' && Number.isFinite(w.size) && w.size > 0 ? w.size : 1
      widgets.push({ id: w.id, collapsed: w.collapsed === true, size })
    }
  }
  return {
    visible: typeof v.visible === 'boolean' ? v.visible : def.visible,
    width,
    mode: v.mode === 'tabs' ? 'tabs' : 'stack',
    activeWidget: nonEmpty(v.activeWidget) ? v.activeWidget : null,
    sessionsCollapsed: v.sessionsCollapsed === true,
    activity: readActivity(v.activity, def.activity),
    widgets
  }
}

function readActivity(v: unknown, def: ActivitySettings): ActivitySettings {
  if (!isObj(v)) return { ...def }
  const height =
    typeof v.height === 'number' && Number.isFinite(v.height)
      ? Math.round(Math.min(ACTIVITY_MAX_HEIGHT, Math.max(ACTIVITY_MIN_HEIGHT, v.height)))
      : def.height
  const tab = ACTIVITY_TABS.find((t) => t === v.tab) ?? def.tab
  return { collapsed: v.collapsed === true, height, tab }
}

function readRecentDir(v: unknown): RecentDir | null {
  // Version 1 kept bare paths.
  if (nonEmpty(v)) return { path: v, at: 0 }
  if (!isObj(v) || !nonEmpty(v.path)) return null
  const at = typeof v.at === 'number' && Number.isFinite(v.at) && v.at > 0 ? v.at : 0
  const dir: RecentDir = { path: v.path, at }
  if (nonEmpty(v.presetId)) dir.presetId = v.presetId
  return dir
}

export function readKids(v: unknown): KidsSettings {
  const def = DEFAULT_KIDS
  if (!isObj(v)) return { ...def }
  const word = isStr(v.exitWord) ? v.exitWord.trim().toLowerCase() : ''
  const volume =
    typeof v.volume === 'number' && Number.isFinite(v.volume)
      ? Math.min(1, Math.max(0, v.volume))
      : def.volume
  return {
    name: isStr(v.name) ? v.name.trim().slice(0, 40) : def.name,
    exitWord: EXIT_WORD.test(word) ? word : def.exitWord,
    volume,
    sound: v.sound === 'notes' ? 'notes' : 'songs',
    speak: typeof v.speak === 'boolean' ? v.speak : def.speak
  }
}

function readTheme(v: unknown): ThemeOverrides {
  const theme: ThemeOverrides = {}
  if (!isObj(v)) return theme
  for (const key of THEME_KEYS) {
    const value = v[key]
    if (isSafeThemeValue(value)) theme[key] = value
  }
  return theme
}

/**
 * Turn whatever is on disk into a valid config. Unknown keys are dropped,
 * missing or malformed values get defaults.
 * Never throws.
 */
export function migrateConfig(raw: unknown): CockpitConfig {
  const def = defaultConfig()
  if (!isObj(raw)) return def

  // Fields are read one by one, so older shapes are upgraded where they're
  // read. Version 2 added times and presets to recentDirs (readRecentDir).
  const rawPresets: unknown = raw.presets

  let presets = def.presets
  if (Array.isArray(rawPresets)) {
    const seen = new Set<string>()
    const read = rawPresets
      .map(readPreset)
      .filter((p): p is Preset => p !== null && !seen.has(p.id) && (seen.add(p.id), true))
    if (read.length > 0) presets = read
  }
  // A shell preset always exists; layout restore falls back to it.
  if (!presets.some((p) => p.id === 'shell'))
    presets = [{ id: 'shell', name: 'Shell', cwd: '~' }, ...presets]

  const keybindings = { ...def.keybindings }
  if (isObj(raw.keybindings)) {
    for (const action of Object.keys(keybindings) as Action[]) {
      const k = raw.keybindings[action]
      if (isStr(k)) keybindings[action] = k
    }
  }

  const terminal = { ...def.terminal }
  if (isObj(raw.terminal)) {
    if (nonEmpty(raw.terminal.fontFamily)) terminal.fontFamily = raw.terminal.fontFamily
    const size = raw.terminal.fontSize
    if (typeof size === 'number' && size >= 6 && size <= 48) terminal.fontSize = size
  }

  const recentDirs: RecentDir[] = []
  if (Array.isArray(raw.recentDirs)) {
    const seen = new Set<string>()
    for (const d of raw.recentDirs.map(readRecentDir)) {
      if (!d || seen.has(d.path)) continue
      seen.add(d.path)
      recentDirs.push(d)
    }
  }

  return {
    version: CONFIG_VERSION,
    presets,
    keybindings,
    terminal,
    theme: readTheme(raw.theme),
    sidebar: readSidebar(raw.sidebar),
    projectsDir: nonEmpty(raw.projectsDir) ? raw.projectsDir : def.projectsDir,
    recentDirs: recentDirs.slice(0, MAX_RECENT_DIRS),
    launcher: {
      presetId:
        isObj(raw.launcher) && nonEmpty(raw.launcher.presetId)
          ? raw.launcher.presetId
          : def.launcher.presetId
    },
    kids: readKids(raw.kids),
    layout: readLayout(raw.layout, new Set(presets.map((p) => p.id)))
  }
}

export function pushRecentDir(dirs: RecentDir[], dir: RecentDir): RecentDir[] {
  return [dir, ...dirs.filter((d) => d.path !== dir.path)].slice(0, MAX_RECENT_DIRS)
}
