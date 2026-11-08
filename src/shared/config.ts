// The shape of ~/.cockpit/config.json, its defaults, and migration from older
// or hand-edited files. Pure so it can be unit tested.
import { ACTIVITY_TABS, type ActivityTab } from './activity'
import { readFrame, withRunsPanel, withTasksPanel, type FrameNode } from './frame'
import { builtInLayout, classicFromSidebar, DEFAULT_LAYOUT_ID } from './layouts'
import { DEFAULT_PR_ACTIONS, isPrRef, MAX_PR_ACTIONS, type PrAction, type PrRef } from './prs'
import { readTaskSettings, type TaskSettings } from './tasks'
import { DEFAULT_THEME_ID, readTokens, type ThemeOverrides } from './theme'
import { isWebUrl } from './web'

export { ACTIVITY_TABS, type ActivityTab }

export const CONFIG_VERSION = 6

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
  | 'newShell'
  | 'newTask'
  | 'openUrl'
  | 'reloadPage'
  | 'splitRight'
  | 'splitDown'
  | 'closePane'
  | 'clearPane'
  | 'resumePane'
  | 'openEditor'
  | 'showPlan'
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
  /** Start the agent at its own session picker. Dropped once the pane has started. */
  resume?: boolean
  /** The agent's first prompt. Dropped once the pane has started. */
  prompt?: string
  /** A web page shown instead of a terminal (http, https, or file). */
  url?: string
  /** A pull request shown instead of a terminal. */
  pr?: PrRef
  /** The web page's or pull request's title, for the tab. */
  title?: string
}

/** A pane that runs a process, as opposed to one showing a web page or a pull request. */
export const isTerminalPane = (p: PaneNode): boolean => !p.url && !p.pr

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

/** Colors a tab's strip can take: theme tokens, so they follow the theme. */
export const TAB_COLORS = ['red', 'yellow', 'green', 'cyan', 'blue', 'magenta'] as const
export type TabColor = (typeof TAB_COLORS)[number]

export const MAX_TAB_NAME = 80

export interface Tab {
  id: string
  root: LayoutNode
  activePaneId: string
  /** Shown instead of the preset and folder. */
  name?: string
  /** A strip along the tab's top edge. */
  color?: TabColor
  /** Kept at the right end of the tab bar. Pinned tabs come after the others in `tabs`. */
  pinned?: boolean
}

export interface Layout {
  tabs: Tab[]
  activeTabId: string | null
}

export interface TerminalSettings {
  fontFamily: string
  fontSize: number
  /** Lines each terminal keeps above the screen. A full one at 200 columns holds about 2.4 KB a line. */
  scrollback: number
}

export interface WidgetPlacement {
  id: string
  collapsed: boolean
  /** Share of the free height among expanded fill widgets (stack mode). */
  size: number
}

/** Version 2's Activity panel settings, read only to migrate them. */
export interface ActivitySettings {
  collapsed: boolean
  /** Height in pixels while widgets share the sidebar; with none, it fills it. */
  height: number
  tab: ActivityTab
}

export const ACTIVITY_MIN_HEIGHT = 96
export const ACTIVITY_MAX_HEIGHT = 2000

/**
 * Version 2's sidebar. Version 3 reads it once to build the classic layout
 * (layouts.ts) and doesn't write it back.
 */
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

export interface RecentPage {
  /** An http, https, or file URL. */
  url: string
  /** The title the page gave itself, if it set one. */
  title?: string
  /** When it last loaded, in ms since the epoch. */
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

/**
 * How every window looks. The chrome owns it; the View menu asks the chrome to
 * change it. Which layout a window uses is in its WindowState.
 */
export interface AppearanceSettings {
  /** A built-in theme's id or a folder name in ~/.cockpit/themes/. */
  theme: string
  /** Tokens that win over the theme's (see theme.ts). */
  overrides: ThemeOverrides
  /** Layouts changed from their built-in version, and layouts written by hand. */
  layouts: Record<string, FrameNode>
}

/** Most windows Cockpit opens: one for each of up to three displays. */
export const MAX_WINDOWS = 3

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

/** The display a window was put on, found again by id, or by name after it was unplugged. */
export interface WindowDisplay {
  id: number
  label: string
}

/** What the window's chrome shows of its own: the layout it uses. */
export interface WindowView {
  /** A built-in layout's id (layouts.ts) or a key of appearance.layouts. */
  layout: string
  /** Cmd+B: only the terminals and the tab bar show. */
  panelsHidden: boolean
  /** Project folders whose tabs the tab bar leaves out. A pane's folder is the one under `projectsDir` it started in. */
  hiddenDirs: string[]
}

/** One window: its layout, its terminal tabs, and where it goes. */
export interface WindowState extends WindowView, Layout {
  id: string
  /** Where it was last moved to, in screen points. */
  bounds?: WindowBounds
  display?: WindowDisplay
}

export interface CockpitConfig {
  version: number
  presets: Preset[]
  keybindings: Keybindings
  terminal: TerminalSettings
  appearance: AppearanceSettings
  /** Directory the Cmd+T picker lists projects from. */
  projectsDir: string
  /** Most recently used working directories, newest first. */
  recentDirs: RecentDir[]
  /** Pages most recently loaded in web panes, newest first. */
  recentPages: RecentPage[]
  launcher: LauncherSettings
  kids: KidsSettings
  /**
   * Command that opens files and projects ("zed", "code -g"), run through the
   * login shell with the path added. null opens them in their default app.
   */
  editor: string | null
  /** What the PRs panel's right-click menu can send to an agent about a pull request. */
  prActions: PrAction[]
  /** Setup for each repository's new task worktrees, by its main checkout ("~/dev/cockpit"). */
  tasks: TaskSettings
  /** The first one is the main window: it reopens when the Dock icon is clicked. */
  windows: WindowState[]
}

export const DEFAULT_PRESETS: Preset[] = [
  { id: 'shell', name: 'Shell', cwd: '~' },
  { id: 'claude', name: 'Claude Code', command: 'claude', cwd: '~/dev' },
  { id: 'codex', name: 'Codex', command: 'codex', cwd: '~/dev' }
]

export const DEFAULT_KEYBINDINGS: Keybindings = {
  newTab: 'Cmd+T',
  newShell: 'Cmd+Shift+T',
  newTask: 'Cmd+Shift+N',
  openUrl: 'Cmd+L',
  reloadPage: 'Cmd+R',
  splitRight: 'Cmd+D',
  splitDown: 'Cmd+Shift+D',
  closePane: 'Cmd+W',
  clearPane: 'Cmd+Shift+Backspace',
  resumePane: 'Cmd+Shift+R',
  openEditor: 'Cmd+Shift+E',
  showPlan: 'Cmd+Shift+P',
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
  fontSize: 13,
  scrollback: 5000
}

/**
 * The font stack a terminal renders with: the configured one, then the Nerd
 * Font symbols, so prompt icons show up in a font that wasn't patched.
 */
export function terminalFontStack(fontFamily: string): string {
  if (/symbols nerd font/i.test(fontFamily)) return fontFamily
  return `${fontFamily}, "Symbols Nerd Font Mono"`
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

export function defaultAppearance(): AppearanceSettings {
  return {
    theme: DEFAULT_THEME_ID,
    overrides: {},
    layouts: {}
  }
}

export const MAIN_WINDOW_ID = 'main'

export function defaultWindow(id = MAIN_WINDOW_ID, layout = DEFAULT_LAYOUT_ID): WindowState {
  return { id, layout, panelsHidden: false, hiddenDirs: [], tabs: [], activeTabId: null }
}

export function defaultConfig(): CockpitConfig {
  return {
    version: CONFIG_VERSION,
    presets: DEFAULT_PRESETS.map((p) => ({ ...p })),
    keybindings: { ...DEFAULT_KEYBINDINGS },
    terminal: { ...DEFAULT_TERMINAL },
    appearance: defaultAppearance(),
    projectsDir: '~/dev',
    recentDirs: [],
    recentPages: [],
    launcher: { presetId: 'claude' },
    kids: { ...DEFAULT_KIDS },
    editor: null,
    prActions: DEFAULT_PR_ACTIONS.map((a) => ({ ...a })),
    tasks: {},
    windows: [defaultWindow()]
  }
}

const MAX_RECENT_DIRS = 20
const MAX_RECENT_PAGES = 20

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

const MAX_TITLE = 200

function readNode(v: unknown, seen: Set<string>): LayoutNode | null {
  if (!isObj(v) || !nonEmpty(v.id) || seen.has(v.id)) return null
  seen.add(v.id)
  if (v.type === 'pane') {
    if (!nonEmpty(v.presetId)) return null
    const pane: PaneNode = {
      type: 'pane',
      id: v.id,
      presetId: v.presetId,
      cwd: nonEmpty(v.cwd) ? v.cwd : '~'
    }
    if (nonEmpty(v.url) && isWebUrl(v.url)) {
      pane.url = v.url
      if (nonEmpty(v.title)) pane.title = v.title.slice(0, MAX_TITLE)
    } else if (isPrRef(v.pr)) {
      pane.pr = { repo: v.pr.repo, number: v.pr.number }
      if (nonEmpty(v.title)) pane.title = v.title.slice(0, MAX_TITLE)
    }
    return pane
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

/** `seen` holds the ids already taken; pane ids are PTY ids, so no two windows share one. */
function readLayout(v: unknown, presetIds: Set<string>, seen = new Set<string>()): Layout {
  const empty: Layout = { tabs: [], activeTabId: null }
  if (!isObj(v) || !Array.isArray(v.tabs)) return empty
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
    const tab: Tab = { id: t.id, root: fixed, activePaneId: active }
    const name = isStr(t.name) ? t.name.trim().slice(0, MAX_TAB_NAME) : ''
    if (name) tab.name = name
    const color = TAB_COLORS.find((c) => c === t.color)
    if (color) tab.color = color
    if (t.pinned === true) tab.pinned = true
    tabs.push(tab)
  }
  // Pinned tabs go last, in the order they were in.
  tabs.sort((a, b) => Number(a.pinned === true) - Number(b.pinned === true))
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

function readRecentPage(v: unknown): RecentPage | null {
  if (!isObj(v) || !nonEmpty(v.url) || !isWebUrl(v.url)) return null
  const at = typeof v.at === 'number' && Number.isFinite(v.at) && v.at > 0 ? v.at : 0
  const page: RecentPage = { url: v.url, at }
  if (nonEmpty(v.title)) page.title = v.title
  return page
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

/**
 * A list, even an empty one, replaces the defaults. Entries without a label
 * and a command are dropped.
 */
export function readPrActions(v: unknown): PrAction[] {
  if (!Array.isArray(v)) return DEFAULT_PR_ACTIONS.map((a) => ({ ...a }))
  const actions: PrAction[] = []
  for (const a of v) {
    if (!isObj(a) || !isStr(a.label) || !isStr(a.command)) continue
    const label = a.label.trim().slice(0, 40)
    const command = a.command.trim()
    if (label && command) actions.push({ label, command })
  }
  return actions.slice(0, MAX_PR_ACTIONS)
}

/** Theme and layout names: folder names and config.json keys. */
const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/
const MAX_LAYOUTS = 20

/**
 * Version 2 had a top-level `theme` of overrides and a `sidebar`. When
 * appearance lacks them, the overrides move into it and the sidebar becomes
 * the classic layout, so an upgrade looks the same.
 */
export function readAppearance(raw: Obj): AppearanceSettings {
  const a = isObj(raw.appearance) ? raw.appearance : {}
  const layouts: Record<string, FrameNode> = {}
  if (isObj(a.layouts)) {
    for (const [name, tree] of Object.entries(a.layouts).slice(0, MAX_LAYOUTS)) {
      if (NAME.test(name)) layouts[name] = readFrame(tree)
    }
  }
  const sidebar = isObj(raw.sidebar) ? readSidebar(raw.sidebar) : null
  if (sidebar && !layouts[DEFAULT_LAYOUT_ID]) {
    layouts[DEFAULT_LAYOUT_ID] = classicFromSidebar(sidebar)
  }
  return {
    theme: isStr(a.theme) && NAME.test(a.theme) ? a.theme : DEFAULT_THEME_ID,
    overrides: readTokens(isObj(a.overrides) ? a.overrides : raw.theme),
    layouts
  }
}

/** A layout name a window can use: built in, or in `layouts`. */
export function layoutExists(a: Pick<AppearanceSettings, 'layouts'>, id: unknown): id is string {
  return isStr(id) && NAME.test(id) && !!(a.layouts[id] ?? builtInLayout(id))
}

const WINDOW_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/
const MIN_WINDOW = 200
const MAX_COORD = 100_000

function readBounds(v: unknown): WindowBounds | undefined {
  if (!isObj(v)) return undefined
  const { x, y, width, height } = v
  const coord = (n: unknown): n is number =>
    typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= MAX_COORD
  if (!coord(x) || !coord(y) || !coord(width) || !coord(height)) return undefined
  if (width < MIN_WINDOW || height < MIN_WINDOW) return undefined
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  }
}

function readDisplay(v: unknown): WindowDisplay | undefined {
  if (!isObj(v) || typeof v.id !== 'number' || !Number.isInteger(v.id)) return undefined
  return { id: v.id, label: isStr(v.label) ? v.label.slice(0, 200) : '' }
}

const MAX_HIDDEN_DIRS = 50

function readHiddenDirs(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const dirs = v.filter((d): d is string => nonEmpty(d) && d.length <= 1024)
  return [...new Set(dirs)].slice(0, MAX_HIDDEN_DIRS)
}

/**
 * Version 4 has a list of windows. Before it, the one window's tabs were the
 * top-level `layout`, and its layout and Cmd+B state were in `appearance`.
 */
function readWindows(
  raw: Obj,
  appearance: AppearanceSettings,
  presetIds: Set<string>
): WindowState[] {
  const seen = new Set<string>()
  const view = (v: Obj): WindowView => ({
    layout: layoutExists(appearance, v.layout) ? v.layout : DEFAULT_LAYOUT_ID,
    panelsHidden: v.panelsHidden === true,
    hiddenDirs: readHiddenDirs(v.hiddenDirs)
  })
  const windows: WindowState[] = []
  if (Array.isArray(raw.windows)) {
    const ids = new Set<string>()
    for (const w of raw.windows) {
      if (windows.length === MAX_WINDOWS) break
      if (!isObj(w) || !isStr(w.id) || !WINDOW_ID.test(w.id) || ids.has(w.id)) continue
      ids.add(w.id)
      const state: WindowState = { id: w.id, ...view(w), ...readLayout(w, presetIds, seen) }
      const bounds = readBounds(w.bounds)
      if (bounds) state.bounds = bounds
      const display = readDisplay(w.display)
      if (display) state.display = display
      windows.push(state)
    }
  }
  if (windows.length > 0) return windows
  const a = isObj(raw.appearance) ? raw.appearance : {}
  // Version 2 kept Cmd+B as the sidebar's `visible`.
  const sidebarHidden = isObj(raw.sidebar) && raw.sidebar.visible === false
  return [
    {
      id: MAIN_WINDOW_ID,
      ...view({
        ...a,
        panelsHidden: typeof a.panelsHidden === 'boolean' ? a.panelsHidden : sidebarHidden
      }),
      ...readLayout(raw.layout, presetIds, seen)
    }
  ]
}

/** The tree of a window's layout, or the classic one if it doesn't exist. */
export function activeLayout(a: AppearanceSettings, layout: string): FrameNode {
  return (
    a.layouts[layout] ??
    builtInLayout(layout) ??
    a.layouts[DEFAULT_LAYOUT_ID] ??
    builtInLayout(DEFAULT_LAYOUT_ID) ??
    readFrame(null)
  )
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
  // Version 3 moved theme and sidebar into appearance (readAppearance).
  // Version 4 moved the tabs and the layout in use into windows (readWindows).
  // Version 5 added the Tasks panel to saved layouts (withTasksPanel), and
  // version 6 the Runs panel (withRunsPanel).
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
    const lines = raw.terminal.scrollback
    if (typeof lines === 'number' && Number.isInteger(lines) && lines >= 0 && lines <= 100_000) {
      terminal.scrollback = lines
    }
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

  const recentPages: RecentPage[] = []
  if (Array.isArray(raw.recentPages)) {
    const seen = new Set<string>()
    for (const p of raw.recentPages.map(readRecentPage)) {
      if (!p || seen.has(p.url)) continue
      seen.add(p.url)
      recentPages.push(p)
    }
  }

  const read = readAppearance(raw)
  const saved = typeof raw.version === 'number' ? raw.version : CONFIG_VERSION
  const upgrade = (tree: FrameNode): FrameNode => {
    const withTasks = saved < 5 ? withTasksPanel(tree) : tree
    return saved < 6 ? withRunsPanel(withTasks) : withTasks
  }
  const appearance =
    saved < 6
      ? {
          ...read,
          layouts: Object.fromEntries(
            Object.entries(read.layouts).map(([name, tree]) => [name, upgrade(tree)])
          )
        }
      : read
  return {
    version: CONFIG_VERSION,
    presets,
    keybindings,
    terminal,
    appearance,
    projectsDir: nonEmpty(raw.projectsDir) ? raw.projectsDir : def.projectsDir,
    recentDirs: recentDirs.slice(0, MAX_RECENT_DIRS),
    recentPages: recentPages.slice(0, MAX_RECENT_PAGES),
    launcher: {
      presetId:
        isObj(raw.launcher) && nonEmpty(raw.launcher.presetId)
          ? raw.launcher.presetId
          : def.launcher.presetId
    },
    kids: readKids(raw.kids),
    editor: isStr(raw.editor) && raw.editor.trim() ? raw.editor.trim() : null,
    prActions: readPrActions(raw.prActions),
    tasks: readTaskSettings(raw.tasks),
    windows: readWindows(raw, appearance, new Set(presets.map((p) => p.id)))
  }
}

export function pushRecentDir(dirs: RecentDir[], dir: RecentDir): RecentDir[] {
  return [dir, ...dirs.filter((d) => d.path !== dir.path)].slice(0, MAX_RECENT_DIRS)
}

/** Put `page` first. A page that comes back without a title keeps the one it had. */
export function pushRecentPage(pages: RecentPage[], page: RecentPage): RecentPage[] {
  const old = pages.find((p) => p.url === page.url)
  const entry = page.title === undefined && old?.title ? { ...page, title: old.title } : page
  return [entry, ...pages.filter((p) => p.url !== page.url)].slice(0, MAX_RECENT_PAGES)
}
