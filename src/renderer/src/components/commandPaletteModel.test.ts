import { describe, expect, it } from 'bun:test'
import { DEFAULT_KEYBINDINGS, DEFAULT_PRESETS } from '@shared/config'
import type { SavedCommand } from '@shared/commands'
import type { PaneSession } from '@shared/ipc'
import type { QuickCommand } from '@shared/quickCommands'
import type { RunView } from '@shared/runs'
import type { TaskInfo } from '@shared/tasks'
import {
  buildPaletteItems,
  filterPaletteItems,
  fuzzyTermScore,
  parsePaletteQuery,
  scorePaletteItem,
  type PaletteSource
} from './commandPaletteModel'

function makeSession(overrides: Partial<PaneSession> = {}): PaneSession {
  return {
    id: 'p1',
    tabId: 't1',
    presetId: 'claude',
    name: 'Claude Code',
    cwd: '~/dev/cockpit',
    branch: 'feat/palette',
    status: 'working',
    since: 1000,
    agent: 'claude',
    title: 'Build command palette',
    tokens: 12000,
    focused: false,
    message: null,
    labels: [],
    background: null,
    activeMs: 0,
    toolCalls: 0,
    ports: [],
    ...overrides
  }
}

function makeTask(overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    path: '~/.cockpit/worktrees/cockpit/feat-palette',
    repo: '~/dev/cockpit',
    branch: 'feat/palette',
    head: 'abc1234',
    changed: 0,
    unpushed: 0,
    pr: null,
    prError: null,
    inPr: false,
    createdAt: 1000,
    ...overrides
  }
}

function makeSource(overrides: Partial<PaletteSource> = {}): PaletteSource {
  const themes = [
    { id: 'dark', name: 'Dark' },
    { id: 'light', name: 'Light' },
    { id: 'broken', name: 'Broken', error: 'bad json' }
  ]
  const quickCommands: QuickCommand[] = [
    {
      id: 'standup',
      label: 'Daily standup',
      preset: 'claude',
      prompt: '/standup',
      background: true
    },
    { id: 'missing', label: 'Missing preset cmd', preset: 'nope', prompt: 'hi', background: false }
  ]
  const slashCommands: SavedCommand[] = [
    {
      name: 'code-review',
      scope: 'global',
      description: 'Review the current PR',
      body: 'Review this pull request thoroughly.',
      path: '~/.claude/commands/code-review.md'
    },
    {
      name: 'release',
      scope: 'repo',
      description: null,
      body: 'Prepare release notes',
      path: '~/dev/cockpit/.claude/commands/release.md'
    }
  ]
  const runs: RunView[] = [
    {
      id: 'run-1',
      title: 'Auth refactor',
      pending: false,
      mode: 'merge',
      maxParallel: 2,
      presetId: 'claude',
      paused: false,
      autoFixCi: false,
      cancelled: false,
      finished: false,
      done: 0,
      total: 1,
      createdAt: 1000,
      items: [
        {
          id: 'item-1',
          title: 'Migrate session tokens',
          branch: 'feat/tokens',
          prompt: 'Migrate tokens',
          after: [],
          state: {
            phase: 'working',
            waitingOn: [],
            startsOn: null,
            agent: 'working',
            path: '~/.cockpit/worktrees/cockpit/feat-tokens',
            pr: null,
            mergedInto: null,
            baseMerged: false,
            reason: null,
            ciFix: null
          }
        }
      ]
    }
  ]
  return {
    sessions: [
      makeSession({ id: 'p-idle', status: 'idle', title: 'Explore docs', branch: 'main' }),
      makeSession({
        id: 'p-needs',
        status: 'needs-input',
        title: 'Approve migration',
        branch: 'feat/db',
        message: 'Allow rm -rf?'
      }),
      makeSession({
        id: 'p-bg',
        status: 'done',
        title: null,
        background: { label: 'Approve ship', input: 'https://slack.example/1' }
      })
    ],
    tasks: [
      makeTask({
        path: '~/.cockpit/worktrees/cockpit/fix-bug',
        branch: 'fix/bug',
        pr: {
          number: 42,
          title: 'Fix crash on startup',
          url: 'https://github.com/NJordan72/cockpit/pull/42',
          state: 'merged',
          draft: false,
          checks: 'passing',
          review: 'approved',
          head: 'abc1234',
          base: 'main'
        },
        inPr: true
      })
    ],
    runs,
    quickCommands,
    slashCommands,
    presets: DEFAULT_PRESETS,
    themes,
    currentTheme: 'dark',
    layouts: [
      { id: 'classic', name: 'Classic' },
      { id: 'cockpit', name: 'Cockpit' }
    ],
    currentLayout: 'classic',
    canResetLayout: true,
    panelsHidden: false,
    windowCount: 2,
    displays: 2,
    keybindings: DEFAULT_KEYBINDINGS,
    hasFocusedPane: true,
    ...overrides
  }
}

describe('parsePaletteQuery', () => {
  it('defaults to fallback scope with no prefix', () => {
    expect(parsePaletteQuery('cockpit')).toEqual({
      scope: 'all',
      query: 'cockpit',
      fromPrefix: false
    })
    expect(parsePaletteQuery('cockpit', 'tasks')).toEqual({
      scope: 'tasks',
      query: 'cockpit',
      fromPrefix: false
    })
  })

  it('recognizes > for commands and @ for sessions', () => {
    expect(parsePaletteQuery('> new task')).toEqual({
      scope: 'commands',
      query: 'new task',
      fromPrefix: true
    })
    expect(parsePaletteQuery('  @feat/db')).toEqual({
      scope: 'sessions',
      query: 'feat/db',
      fromPrefix: true
    })
  })
})

describe('fuzzyTermScore', () => {
  it('ranks exact < prefix < word-boundary < substring < subsequence', () => {
    const exact = fuzzyTermScore('dark', 'Dark')
    const prefix = fuzzyTermScore('dark', 'Darker theme')
    const boundary = fuzzyTermScore('dark', 'Solarized Dark')
    const mid = fuzzyTermScore('ark', 'Solarized Dark')
    const subseq = fuzzyTermScore('drk', 'Dark')

    if (exact === null || prefix === null || boundary === null || mid === null || subseq === null) {
      throw new Error('expected all fuzzy terms to match')
    }
    expect(exact).toBeLessThan(prefix)
    expect(prefix).toBeLessThan(boundary)
    expect(boundary).toBeLessThan(mid)
    expect(mid).toBeLessThan(subseq)
  })

  it('returns null when characters are not in order', () => {
    expect(fuzzyTermScore('xyz', 'Dark')).toBeNull()
    expect(fuzzyTermScore('kd', 'Dark')).toBeNull()
  })
})

describe('buildPaletteItems', () => {
  it('indexes sessions, tasks, runs, quick commands, slash commands, layouts, themes, and core actions', () => {
    const items = buildPaletteItems(makeSource())
    const byId = new Map(items.map((i) => [i.id, i]))

    // Sessions
    expect(byId.get('session:p-needs')?.dot).toBe('needs-input')
    expect(byId.get('session:p-bg')?.label).toBe('Approve ship')

    // Tasks
    expect(byId.get('task:~/.cockpit/worktrees/cockpit/fix-bug')?.tag).toBe('#42 merged')

    // Runs & run items
    expect(byId.get('run-toggle:run-1')?.label).toBe('Pause run: Auth refactor')
    expect(byId.get('run-item:run-1:item-1')?.label).toBe('Migrate session tokens')

    // Quick commands (missing preset is marked disabled)
    expect(byId.get('quick:standup')?.disabled).toBe(false)
    expect(byId.get('quick:missing')?.disabled).toBe(true)

    // Slash commands
    expect(byId.get('slash:global:code-review')?.label).toBe('/code-review')
    expect(byId.get('slash:repo:release')?.tag).toBe('repo')

    // Core actions (clean up merged reflects merged count, window count 1/2/3)
    expect(byId.get('action:cleanUpMerged')?.label).toBe('Clean up merged tasks (1)')
    expect(byId.get('action:cleanUpMerged')?.disabled).toBe(false)
    expect(byId.get('action:windows:1')).toBeDefined()
    expect(byId.get('action:windows:2')?.tag).toBe('active')
    expect(byId.get('action:windows:3')).toBeDefined()
    expect(byId.get('action:toggleSidebar')?.label).toBe('Hide panels')

    // Layouts & reset layout
    expect(byId.get('layout:classic')?.tag).toBe('active')
    expect(byId.get('layout:reset')).toBeDefined()

    // Themes (broken themes skipped)
    expect(byId.get('theme:dark')?.tag).toBe('active')
    expect(byId.get('theme:light')).toBeDefined()
    expect(byId.get('theme:broken')).toBeUndefined()
  })

  it('disables pane-scoped actions when no pane is focused and cleanUpMerged when none are merged', () => {
    const items = buildPaletteItems(
      makeSource({ hasFocusedPane: false, tasks: [], panelsHidden: true, canResetLayout: false })
    )
    const byId = new Map(items.map((i) => [i.id, i]))
    expect(byId.get('action:splitRight')?.disabled).toBe(true)
    expect(byId.get('action:cleanUpMerged')?.disabled).toBe(true)
    expect(byId.get('action:toggleSidebar')?.label).toBe('Show panels')
    expect(byId.get('layout:reset')).toBeUndefined()
  })
})

describe('filterPaletteItems', () => {
  const items = buildPaletteItems(makeSource())

  it('orders sessions by urgency when query is empty (needs-input before done before idle)', () => {
    const result = filterPaletteItems(items, '@')
    expect(result.map((i) => i.id)).toEqual(['session:p-needs', 'session:p-bg', 'session:p-idle'])
  })

  it('filters to actions and commands with > prefix', () => {
    const result = filterPaletteItems(items, '>')
    expect(result.length).toBeGreaterThan(0)
    expect(
      result.every(
        (i) => i.category === 'action' || i.category === 'quick' || i.category === 'command'
      )
    ).toBe(true)
  })

  it('searches across all categories by default', () => {
    const byBranch = filterPaletteItems(items, 'feat/db')
    expect(byBranch[0]?.id).toBe('session:p-needs')

    const byTheme = filterPaletteItems(items, 'light')
    expect(byTheme.some((i) => i.id === 'theme:light')).toBe(true)

    const bySlash = filterPaletteItems(items, '/code-review')
    expect(bySlash[0]?.id).toBe('slash:global:code-review')

    const byTaskPr = filterPaletteItems(items, '#42')
    expect(byTaskPr[0]?.id).toBe('task:~/.cockpit/worktrees/cockpit/fix-bug')
  })

  it('supports multi-term fuzzy queries across label and keywords', () => {
    const result = filterPaletteItems(items, 'claude needs')
    expect(result[0]?.id).toBe('session:p-needs')

    const win = filterPaletteItems(items, 'window 3')
    expect(win[0]?.id).toBe('action:windows:3')
  })

  it('prefers label matches over keyword-only matches', () => {
    const direct = items.find((i) => i.id === 'action:newTask')
    const secondary = items.find((i) => i.id === 'task:~/.cockpit/worktrees/cockpit/fix-bug')
    if (!direct || !secondary) throw new Error('missing expected items')
    const directScore = scorePaletteItem('new task', direct)
    const secondaryScore = scorePaletteItem('task', secondary)
    if (directScore === null || secondaryScore === null) throw new Error('expected scores')
    expect(directScore).toBeLessThan(secondaryScore)
  })
})
