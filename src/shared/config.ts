// The shape of ~/.cockpit/config.json, its defaults, and migration from older
// or hand-edited files. Pure so it can be unit tested.
import { ACTIVITY_TABS, type ActivityTab } from './activity'
import { readFrame, type FrameNode } from './frame'
import { builtInLayout, classicFromSidebar, DEFAULT_LAYOUT_ID } from './layouts'
import { DEFAULT_THEME_ID, readTokens, type ThemeOverrides } from './theme'
import { isWebUrl } from './web'

export { ACTIVITY_TABS, type ActivityTab }

export const CONFIG_VERSION = 3

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
  | 'openUrl'
  | 'reloadPage'
  | 'splitRight'
  | 'splitDown'
  | 'closePane'
  | 'clearPane'
  | 'resumePane'
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
  /** The web page's title, for the tab. */
  title?: string
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

/** How the window looks. The chrome owns it; the View menu asks the chrome to change it. */
export interface AppearanceSettings {
  /** A built-in theme's id or a folder name in ~/.cockpit/themes/. */
  theme: string
  /** Tokens that win over the theme's (see theme.ts). */
  overrides: ThemeOverrides
  /** The layout in use: a built-in one's id (layouts.ts) or a key of `layouts`. */
  layout: string
  /** Layouts changed from their built-in version, and layouts written by hand. */
  layouts: Record<string, FrameNode>
  /** Cmd+B: only the terminals and the tab bar show. */
  panelsHidden: boolean
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
  layout: Layout
}

export const DEFAULT_PRESETS: Preset[] = [
  { id: 'shell', name: 'Shell', cwd: '~' },
  { id: 'claude', name: 'Claude Code', command: 'claude', cwd: '~/dev' },
  { id: 'codex', name: 'Codex', command: 'codex', cwd: '~/dev' }
]

export const DEFAULT_KEYBINDINGS: Keybindings = {
  newTab: 'Cmd+T',
  newShell: 'Cmd+Shift+T',
  openUrl: 'Cmd+L',
  reloadPage: 'Cmd+R',
  splitRight: 'Cmd+D',
  splitDown: 'Cmd+Shift+D',
  closePane: 'Cmd+W',
  clearPane: 'Cmd+Shift+Backspace',
  resumePane: 'Cmd+Shift+R',
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
    layout: DEFAULT_LAYOUT_ID,
    layouts: {},
    panelsHidden: false
  }
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
    layout: { tabs: [], activeTabId: null }
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
  const layout =
    isStr(a.layout) && NAME.test(a.layout) && (layouts[a.layout] ?? builtInLayout(a.layout))
      ? a.layout
      : DEFAULT_LAYOUT_ID
  return {
    theme: isStr(a.theme) && NAME.test(a.theme) ? a.theme : DEFAULT_THEME_ID,
    overrides: readTokens(isObj(a.overrides) ? a.overrides : raw.theme),
    layout,
    layouts,
    panelsHidden:
      typeof a.panelsHidden === 'boolean' ? a.panelsHidden : sidebar ? !sidebar.visible : false
  }
}

/** The tree of the layout in use, or the classic one if it doesn't exist. */
export function activeLayout(a: AppearanceSettings): FrameNode {
  return (
    a.layouts[a.layout] ??
    builtInLayout(a.layout) ??
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

  const recentPages: RecentPage[] = []
  if (Array.isArray(raw.recentPages)) {
    const seen = new Set<string>()
    for (const p of raw.recentPages.map(readRecentPage)) {
      if (!p || seen.has(p.url)) continue
      seen.add(p.url)
      recentPages.push(p)
    }
  }

  return {
    version: CONFIG_VERSION,
    presets,
    keybindings,
    terminal,
    appearance: readAppearance(raw),
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
    layout: readLayout(raw.layout, new Set(presets.map((p) => p.id)))
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
