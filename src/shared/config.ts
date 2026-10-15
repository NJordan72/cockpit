// The shape of ~/.cockpit/config.json, its defaults, and migration from older
// or hand-edited files. Pure so it can be unit tested.

export const CONFIG_VERSION = 1

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

export interface CockpitConfig {
  version: number
  presets: Preset[]
  keybindings: Keybindings
  terminal: TerminalSettings
  /** Directory the Cmd+T picker lists projects from. */
  projectsDir: string
  /** Most recently used working directories, newest first. */
  recentDirs: string[]
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
  goToTab9: 'Cmd+9'
}

export const DEFAULT_TERMINAL: TerminalSettings = {
  fontFamily:
    '"0xProto Nerd Font Mono", "JetBrainsMono Nerd Font Mono", ui-monospace, Menlo, monospace',
  fontSize: 13
}

export function defaultConfig(): CockpitConfig {
  return {
    version: CONFIG_VERSION,
    presets: DEFAULT_PRESETS.map((p) => ({ ...p })),
    keybindings: { ...DEFAULT_KEYBINDINGS },
    terminal: { ...DEFAULT_TERMINAL },
    projectsDir: '~/dev',
    recentDirs: [],
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

/**
 * Turn whatever is on disk into a valid config. Unknown keys are dropped,
 * missing or malformed values get defaults.
 * Never throws.
 */
export function migrateConfig(raw: unknown): CockpitConfig {
  const def = defaultConfig()
  if (!isObj(raw)) return def

  // Version 1 is the first format. When the format changes, upgrade older
  // shapes here (keyed on raw.version) before the field-by-field read below.
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

  const recentDirs = Array.isArray(raw.recentDirs)
    ? [...new Set(raw.recentDirs.filter(nonEmpty))].slice(0, MAX_RECENT_DIRS)
    : []

  return {
    version: CONFIG_VERSION,
    presets,
    keybindings,
    terminal,
    projectsDir: nonEmpty(raw.projectsDir) ? raw.projectsDir : def.projectsDir,
    recentDirs,
    layout: readLayout(raw.layout, new Set(presets.map((p) => p.id)))
  }
}

export function pushRecentDir(dirs: string[], dir: string): string[] {
  return [dir, ...dirs.filter((d) => d !== dir)].slice(0, MAX_RECENT_DIRS)
}
