// Pure model, item generation, prefix parsing, and fuzzy ranking for the
// unified command palette (Cmd+P).
import type { SavedCommand } from '@shared/commands'
import { MAX_WINDOWS, type Action, type Keybindings, type Preset } from '@shared/config'
import type { PaneSession } from '@shared/ipc'
import type { QuickCommand } from '@shared/quickCommands'
import type { RunItemView, RunView } from '@shared/runs'
import { mergedAndClean, prLabel, taskAt, type TaskInfo } from '@shared/tasks'
import type { ThemeDefinition } from '@shared/theme'
import type { SessionStatus } from '@shared/widgets'
import { chordLabel } from '../keybindings'
import { itemDot, itemMeta, phaseLabel, runMeta, sessionsIn } from '../runs/model'
import { STATUS_LABEL } from '../sessions'
import { prChip, sessionsByTask, taskMeta } from '../tasks/model'

export type PaletteCategory =
  'session' | 'task' | 'run' | 'quick' | 'command' | 'action' | 'layout' | 'theme'

export type PaletteScope = 'all' | 'sessions' | 'commands' | 'tasks' | 'runs' | 'appearance'

export const PALETTE_SCOPES: readonly { id: PaletteScope; label: string; prefix?: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'sessions', label: 'Sessions', prefix: '@' },
  { id: 'commands', label: 'Commands', prefix: '>' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'runs', label: 'Runs' },
  { id: 'appearance', label: 'Appearance' }
]

const SCOPE_CATEGORIES: Record<PaletteScope, readonly PaletteCategory[] | null> = {
  all: null,
  sessions: ['session'],
  commands: ['action', 'quick', 'command'],
  tasks: ['task'],
  runs: ['run'],
  appearance: ['layout', 'theme']
}

export type PaletteEffect =
  | { type: 'session'; paneId: string }
  | { type: 'task'; task: TaskInfo }
  | { type: 'runItem'; run: RunView; item: RunItemView }
  | { type: 'runToggle'; runId: string; action: 'pause' | 'resume' }
  | { type: 'quickCommand'; command: QuickCommand }
  | { type: 'slashCommand'; command: SavedCommand }
  | { type: 'action'; action: Action }
  | { type: 'cleanUpMerged' }
  | { type: 'windows'; count: number }
  | { type: 'layout'; layoutId: string }
  | { type: 'resetLayout' }
  | { type: 'theme'; themeId: string }

export interface PaletteItem {
  id: string
  category: PaletteCategory
  label: string
  detail: string
  /** Extra searchable text (branch, repo, preset, status, aliases). */
  keywords: string[]
  /** Short badge on the right (status, PR chip, active, category). */
  tag?: string
  /** Formatted keybinding shortcut (e.g. "⇧⌘N"). */
  shortcut?: string
  /** Optional status dot class (e.g. "needs-input", "working", "merged"). */
  dot?: string
  /** Lower comes first when scores tie or query is empty. */
  priority: number
  disabled?: boolean
  effect: PaletteEffect
}

export interface PaletteSource {
  sessions: readonly PaneSession[]
  tasks: readonly TaskInfo[]
  runs: readonly RunView[]
  quickCommands: readonly QuickCommand[]
  slashCommands: readonly SavedCommand[]
  presets: readonly Preset[]
  themes: readonly Pick<ThemeDefinition, 'id' | 'name' | 'error'>[]
  currentTheme: string
  layouts: readonly { id: string; name: string }[]
  currentLayout: string
  canResetLayout: boolean
  panelsHidden: boolean
  windowCount: number
  displays: number
  keybindings: Keybindings
  hasFocusedPane: boolean
}

const basename = (p: string): string =>
  p === '~' ? '~' : (p.split('/').filter(Boolean).pop() ?? p)

const SESSION_URGENCY: Record<SessionStatus, number> = {
  'needs-input': 0,
  done: 1,
  working: 2,
  idle: 3,
  exited: 4
}

const CATEGORY_LABEL: Record<PaletteCategory, string> = {
  session: 'session',
  task: 'task',
  run: 'run',
  quick: 'quick',
  command: 'slash',
  action: 'action',
  layout: 'layout',
  theme: 'theme'
}

const CATEGORY_PRIORITY: Record<PaletteCategory, number> = {
  session: 10,
  task: 20,
  run: 30,
  quick: 40,
  command: 50,
  action: 60,
  layout: 70,
  theme: 80
}

/** Parse leading `>` (commands/actions) or `@` (sessions) prefix from a query. */
export function parsePaletteQuery(
  raw: string,
  fallbackScope: PaletteScope = 'all'
): { scope: PaletteScope; query: string; fromPrefix: boolean } {
  const trimmed = raw.trimStart()
  if (trimmed.startsWith('>')) {
    return { scope: 'commands', query: trimmed.slice(1).trim(), fromPrefix: true }
  }
  if (trimmed.startsWith('@')) {
    return { scope: 'sessions', query: trimmed.slice(1).trim(), fromPrefix: true }
  }
  return { scope: fallbackScope, query: trimmed.trim(), fromPrefix: false }
}

const isBoundary = (text: string, index: number): boolean => {
  if (index === 0) return true
  const prev = text[index - 1] ?? ''
  return (
    prev === ' ' || prev === '/' || prev === '-' || prev === '_' || prev === '·' || prev === ':'
  )
}

/**
 * Case-insensitive fuzzy score for a single query term against a text.
 * Lower score is better; null means no match.
 */
export function fuzzyTermScore(term: string, text: string): number | null {
  if (!term) return 0
  const q = term.toLowerCase()
  const t = text.toLowerCase()
  if (!t) return null

  if (t === q) return 0
  if (t.startsWith(q)) return 5 + Math.min(20, t.length - q.length)

  const sub = t.indexOf(q)
  if (sub !== -1) {
    return (isBoundary(t, sub) ? 20 : 45) + sub
  }

  let ti = 0
  let score = 100
  let consecutive = 0
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found === -1) return null
    if (found === ti) {
      consecutive++
      score -= Math.min(3, consecutive)
    } else {
      consecutive = 0
      score += (found - ti) * (isBoundary(t, found) ? 1 : 2)
    }
    ti = found + 1
  }
  return Math.max(80, score)
}

/**
 * Score a multi-term query against a palette item.
 * Every whitespace-separated term must match at least one of label, detail, or keywords.
 */
export function scorePaletteItem(query: string, item: PaletteItem): number | null {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return 0

  let total = 0
  for (const term of terms) {
    let best: number | null = fuzzyTermScore(term, item.label)
    const detailScore = fuzzyTermScore(term, item.detail)
    if (detailScore !== null) {
      const weighted = detailScore + 150
      if (best === null || weighted < best) best = weighted
    }
    for (const kw of item.keywords) {
      const kwScore = fuzzyTermScore(term, kw)
      if (kwScore !== null) {
        const weighted = kwScore + 220
        if (best === null || weighted < best) best = weighted
      }
    }
    if (best === null) return null
    total += best
  }
  return total
}

function quickDetail(cmd: QuickCommand, preset: Preset | undefined): string {
  return [
    preset?.name ?? `no preset "${cmd.preset}"`,
    cmd.model,
    cmd.effort,
    cmd.background ? 'background' : 'in a tab'
  ]
    .filter(Boolean)
    .join(' · ')
}

function windowsLabel(count: number, displays: number): string {
  const what = count === 1 ? '1 window' : `${String(count)} windows`
  if (count === 1) return what
  if (displays >= count) return `${what} (one per display)`
  if (displays === 1) return `${what} (side by side)`
  return `${what} (on ${String(displays)} displays)`
}

/** Build the complete list of searchable palette items from current app state. */
export function buildPaletteItems(source: PaletteSource): PaletteItem[] {
  const items: PaletteItem[] = []
  const presetMap = new Map(source.presets.map((p) => [p.id, p]))
  const openByTask = sessionsByTask(source.tasks, source.sessions)

  // 1. Open sessions (across all windows, including background runs)
  for (const s of source.sessions) {
    const task = taskAt(source.tasks, s.cwd)
    const branch = task?.branch ?? s.branch
    const repo = task ? basename(task.repo) : basename(s.cwd)
    const statusLabel = STATUS_LABEL[s.status]
    const run = s.background
    const label = run ? run.label : (s.title ?? `${s.name} · ${branch ?? repo}`)
    const detailParts = run
      ? [s.name, run.input, branch ? `⎇ ${branch}` : repo, 'background']
      : s.title
        ? [s.name, branch ? `⎇ ${branch}` : repo, s.cwd]
        : [s.cwd]
    const keywords = [
      'session',
      s.name,
      s.presetId,
      s.cwd,
      repo,
      s.status,
      statusLabel,
      ...(branch ? [branch] : []),
      ...(task
        ? [task.repo, ...(task.pr ? [`#${String(task.pr.number)}`, task.pr.title] : [])]
        : []),
      ...(s.title ? [s.title] : []),
      ...(run ? ['background', run.label, ...(run.input ? [run.input] : [])] : []),
      ...(s.message ? [s.message] : [])
    ]
    items.push({
      id: `session:${s.id}`,
      category: 'session',
      label,
      detail: detailParts.filter(Boolean).join(' · '),
      keywords,
      tag: s.focused ? `${statusLabel} · active` : statusLabel,
      dot: s.status,
      priority: CATEGORY_PRIORITY.session + SESSION_URGENCY[s.status] + (s.focused ? 0.5 : 0),
      effect: { type: 'session', paneId: s.id }
    })
  }

  // 2. Tasks (worktrees)
  for (const t of source.tasks) {
    const here = openByTask.get(t.path) ?? []
    const repoName = basename(t.repo)
    const label = t.branch ?? `(detached) ${basename(t.path)}`
    const meta = taskMeta(t, here.length)
    const detail = t.pr ? `${meta} · #${String(t.pr.number)} ${t.pr.title}` : meta
    const keywords = [
      'task',
      'worktree',
      repoName,
      t.repo,
      t.path,
      ...(t.branch ? [t.branch] : []),
      ...(t.pr ? [`#${String(t.pr.number)}`, t.pr.title, prLabel(t.pr), t.pr.state] : [])
    ]
    items.push({
      id: `task:${t.path}`,
      category: 'task',
      label,
      detail,
      keywords,
      tag: t.pr ? prChip(t.pr) : 'task',
      dot: here[0]?.status ?? 'exited',
      priority: CATEGORY_PRIORITY.task + (here.length > 0 ? 0 : 1),
      effect: { type: 'task', task: t }
    })
  }

  // 3. Runs & run items
  for (const run of source.runs) {
    if (!run.cancelled && !run.finished) {
      const action: 'pause' | 'resume' = run.paused ? 'resume' : 'pause'
      items.push({
        id: `run-toggle:${run.id}`,
        category: 'run',
        label: `${run.paused ? 'Resume' : 'Pause'} run: ${run.title}`,
        detail: runMeta(run),
        keywords: ['run', action, run.title, run.mode],
        tag: run.paused ? 'paused' : 'run',
        priority: CATEGORY_PRIORITY.run,
        effect: { type: 'runToggle', runId: run.id, action }
      })
    }
    for (const item of run.items) {
      const open = sessionsIn(item, source.sessions)
      const actionable =
        open.length > 0 ||
        Boolean(item.state.path && !item.external) ||
        Boolean(item.state.pr && item.state.path) ||
        (!item.external &&
          !run.cancelled &&
          (item.state.phase === 'waiting' || item.state.phase === 'ready')) ||
        Boolean(item.url)
      if (!actionable) continue
      const branch = item.external ? null : item.branch
      items.push({
        id: `run-item:${run.id}:${item.id}`,
        category: 'run',
        label: item.title,
        detail: `${run.title} · ${itemMeta(item, run)}`,
        keywords: [
          'run',
          run.title,
          item.id,
          item.state.phase,
          phaseLabel(item.state),
          ...(branch ? [branch] : []),
          ...(item.state.pr ? [`#${String(item.state.pr.number)}`, item.state.pr.title] : [])
        ],
        tag: phaseLabel(item.state),
        dot: itemDot(item.state),
        priority: CATEGORY_PRIORITY.run + 1,
        effect: { type: 'runItem', run, item }
      })
    }
  }

  // 4. Quick commands
  for (const cmd of source.quickCommands) {
    const preset = presetMap.get(cmd.preset)
    items.push({
      id: `quick:${cmd.id}`,
      category: 'quick',
      label: cmd.label,
      detail: quickDetail(cmd, preset),
      keywords: [
        'quick',
        'command',
        cmd.id,
        cmd.preset,
        ...(preset ? [preset.name] : []),
        ...(cmd.model ? [cmd.model] : []),
        ...(cmd.effort ? [cmd.effort] : []),
        cmd.background ? 'background' : 'tab'
      ],
      tag: 'quick',
      priority: CATEGORY_PRIORITY.quick,
      disabled: !preset,
      effect: { type: 'quickCommand', command: cmd }
    })
  }

  // 5. Slash commands
  for (const cmd of source.slashCommands) {
    items.push({
      id: `slash:${cmd.scope}:${cmd.name}`,
      category: 'command',
      label: `/${cmd.name}`,
      detail: cmd.description ?? cmd.body.split('\n')[0]?.slice(0, 80) ?? cmd.path,
      keywords: [
        'slash',
        'command',
        cmd.name,
        cmd.scope,
        ...(cmd.description ? [cmd.description] : [])
      ],
      tag: cmd.scope === 'repo' ? 'repo' : 'global',
      priority: CATEGORY_PRIORITY.command,
      effect: { type: 'slashCommand', command: cmd }
    })
  }

  // 6. Core app actions
  const key = (a: Action): string | undefined => chordLabel(source.keybindings[a]) ?? undefined
  const mergedCount = source.tasks.filter(mergedAndClean).length
  const coreActions: {
    id: string
    label: string
    detail: string
    keywords: string[]
    shortcut?: string
    disabled?: boolean
    tag?: string
    effect: PaletteEffect
  }[] = [
    {
      id: 'action:newTab',
      label: 'New tab',
      detail: 'Open a new terminal or web tab',
      keywords: ['tab', 'open', 'picker', 'terminal'],
      shortcut: key('newTab'),
      effect: { type: 'action', action: 'newTab' }
    },
    {
      id: 'action:newShell',
      label: 'New shell tab',
      detail: 'Open a plain shell in the focused directory',
      keywords: ['shell', 'terminal', 'bash', 'zsh'],
      shortcut: key('newShell'),
      effect: { type: 'action', action: 'newShell' }
    },
    {
      id: 'action:newTask',
      label: 'New task',
      detail: 'Start a branch in a git worktree of its own',
      keywords: ['task', 'worktree', 'branch', 'git'],
      shortcut: key('newTask'),
      effect: { type: 'action', action: 'newTask' }
    },
    {
      id: 'action:cleanUpMerged',
      label:
        mergedCount > 0
          ? `Clean up merged tasks (${String(mergedCount)})`
          : 'Clean up merged tasks',
      detail:
        mergedCount > 0
          ? 'Remove tasks whose pull request merged with nothing newer'
          : 'No merged tasks ready to clean up',
      keywords: ['clean', 'cleanup', 'merged', 'tasks', 'worktree', 'prune'],
      disabled: mergedCount === 0,
      effect: { type: 'cleanUpMerged' }
    },
    {
      id: 'action:openUrl',
      label: 'Open web page',
      detail: 'Open a URL or local HTML file in a pane',
      keywords: ['web', 'url', 'browser', 'page'],
      shortcut: key('openUrl'),
      effect: { type: 'action', action: 'openUrl' }
    },
    {
      id: 'action:quickCommand',
      label: 'Quick command…',
      detail: 'Open the quick command picker',
      keywords: ['quick', 'command', 'prompt'],
      shortcut: key('quickCommand'),
      effect: { type: 'action', action: 'quickCommand' }
    },
    {
      id: 'action:toggleSidebar',
      label: source.panelsHidden ? 'Show panels' : 'Hide panels',
      detail: 'Toggle every panel around the terminals',
      keywords: ['toggle', 'panels', 'sidebar', 'focus', 'zen'],
      shortcut: key('toggleSidebar'),
      effect: { type: 'action', action: 'toggleSidebar' }
    },
    {
      id: 'action:splitRight',
      label: 'Split right',
      detail: 'Split the focused pane side by side',
      keywords: ['split', 'pane', 'horizontal', 'right'],
      shortcut: key('splitRight'),
      disabled: !source.hasFocusedPane,
      effect: { type: 'action', action: 'splitRight' }
    },
    {
      id: 'action:splitDown',
      label: 'Split down',
      detail: 'Split the focused pane top to bottom',
      keywords: ['split', 'pane', 'vertical', 'down'],
      shortcut: key('splitDown'),
      disabled: !source.hasFocusedPane,
      effect: { type: 'action', action: 'splitDown' }
    },
    {
      id: 'action:clearPane',
      label: 'Clear pane',
      detail: 'Restart the focused pane’s preset fresh',
      keywords: ['clear', 'restart', 'reset', 'pane'],
      shortcut: key('clearPane'),
      disabled: !source.hasFocusedPane,
      effect: { type: 'action', action: 'clearPane' }
    },
    {
      id: 'action:resumePane',
      label: 'Resume session',
      detail: 'Pick an older agent session in the focused pane',
      keywords: ['resume', 'history', 'session', 'pane'],
      shortcut: key('resumePane'),
      disabled: !source.hasFocusedPane,
      effect: { type: 'action', action: 'resumePane' }
    },
    {
      id: 'action:openEditor',
      label: 'Open in editor',
      detail: 'Open the focused pane’s project in your editor',
      keywords: ['editor', 'code', 'zed', 'open', 'project'],
      shortcut: key('openEditor'),
      disabled: !source.hasFocusedPane,
      effect: { type: 'action', action: 'openEditor' }
    },
    {
      id: 'action:showPlan',
      label: 'Show plan',
      detail: 'Read the focused pane’s proposed plan',
      keywords: ['plan', 'markdown', 'claude'],
      shortcut: key('showPlan'),
      disabled: !source.hasFocusedPane,
      effect: { type: 'action', action: 'showPlan' }
    },
    {
      id: 'action:closePane',
      label: 'Close pane',
      detail: 'Close the focused pane (or tab if it is the last pane)',
      keywords: ['close', 'kill', 'pane', 'tab'],
      shortcut: key('closePane'),
      disabled: !source.hasFocusedPane,
      effect: { type: 'action', action: 'closePane' }
    },
    {
      id: 'action:kidsMode',
      label: 'Kids mode',
      detail: 'Start the pretend terminal for kids',
      keywords: ['kids', 'mode', 'play'],
      shortcut: key('kidsMode'),
      effect: { type: 'action', action: 'kidsMode' }
    }
  ]

  for (const a of coreActions) {
    items.push({
      id: a.id,
      category: 'action',
      label: a.label,
      detail: a.detail,
      keywords: ['action', ...a.keywords],
      shortcut: a.shortcut,
      tag: a.tag,
      priority: CATEGORY_PRIORITY.action,
      disabled: a.disabled,
      effect: a.effect
    })
  }

  for (let n = 1; n <= MAX_WINDOWS; n++) {
    const active = n === source.windowCount
    items.push({
      id: `action:windows:${String(n)}`,
      category: 'action',
      label: `Window count: ${String(n)}`,
      detail: active
        ? `Arrange ${windowsLabel(n, source.displays)}`
        : `Switch to ${windowsLabel(n, source.displays)}`,
      keywords: ['window', 'windows', 'count', 'display', 'displays', 'arrange', String(n)],
      tag: active ? 'active' : undefined,
      priority: CATEGORY_PRIORITY.action + 2,
      effect: { type: 'windows', count: n }
    })
  }

  // 7. Layouts
  for (const l of source.layouts) {
    const active = l.id === source.currentLayout
    items.push({
      id: `layout:${l.id}`,
      category: 'layout',
      label: l.name,
      detail: active ? 'Current layout' : 'Switch layout',
      keywords: ['layout', 'view', l.id, l.name],
      tag: active ? 'active' : 'layout',
      priority: CATEGORY_PRIORITY.layout + (active ? 0 : 1),
      effect: { type: 'layout', layoutId: l.id }
    })
  }
  if (source.canResetLayout) {
    items.push({
      id: 'layout:reset',
      category: 'layout',
      label: 'Reset layout',
      detail: 'Restore the current built-in layout to its default splits',
      keywords: ['layout', 'reset', 'default', 'restore'],
      tag: 'layout',
      priority: CATEGORY_PRIORITY.layout + 2,
      effect: { type: 'resetLayout' }
    })
  }

  // 8. Themes
  for (const t of source.themes) {
    if (t.error) continue
    const active = t.id === source.currentTheme
    items.push({
      id: `theme:${t.id}`,
      category: 'theme',
      label: t.name,
      detail: active ? 'Current theme' : 'Switch theme',
      keywords: ['theme', 'color', 'appearance', t.id, t.name],
      tag: active ? 'active' : 'theme',
      priority: CATEGORY_PRIORITY.theme + (active ? 0 : 1),
      effect: { type: 'theme', themeId: t.id }
    })
  }

  return items
}

/** Filter by prefix/scope and rank items by fuzzy match score, then priority. */
export function filterPaletteItems(
  items: readonly PaletteItem[],
  rawQuery: string,
  fallbackScope: PaletteScope = 'all'
): PaletteItem[] {
  const { scope, query } = parsePaletteQuery(rawQuery, fallbackScope)
  const allowed = SCOPE_CATEGORIES[scope]
  const scoped = allowed ? items.filter((item) => allowed.includes(item.category)) : items

  if (!query) {
    return [...scoped]
      .map((item, index) => ({ item, index }))
      .sort(
        (a, b) =>
          Number(Boolean(a.item.disabled)) - Number(Boolean(b.item.disabled)) ||
          a.item.priority - b.item.priority ||
          a.index - b.index
      )
      .map((x) => x.item)
  }

  return scoped
    .map((item, index) => ({ item, index, score: scorePaletteItem(query, item) }))
    .filter((x): x is { item: PaletteItem; index: number; score: number } => x.score !== null)
    .sort(
      (a, b) =>
        Number(Boolean(a.item.disabled)) - Number(Boolean(b.item.disabled)) ||
        a.score - b.score ||
        a.item.priority - b.item.priority ||
        a.index - b.index
    )
    .map((x) => x.item)
}

export function categoryLabel(category: PaletteCategory): string {
  return CATEGORY_LABEL[category]
}
