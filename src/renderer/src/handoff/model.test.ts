import { describe, expect, it } from 'bun:test'
import { DEFAULT_PRESETS, type Preset } from '@shared/config'
import type { PaneSession } from '@shared/ipc'
import {
  defaultComparePresets,
  handoffChoices,
  handoffMenuItems,
  planReviewPrompt,
  selectionPrompt
} from './model'

const session = (id: string, cwd: string, extra: Partial<PaneSession> = {}): PaneSession => ({
  id,
  tabId: 't',
  presetId: 'claude',
  name: 'Claude Code',
  cwd,
  status: 'idle',
  since: 0,
  agent: 'claude',
  title: null,
  tokens: null,
  focused: false,
  message: null,
  branch: null,
  labels: [],
  background: null,
  ...extra
})

describe('handoffChoices', () => {
  it('lists other running agent panes (same dir first), then agent presets with other presets first', () => {
    const groups = handoffChoices({
      sourcePaneId: 'src',
      sourceCwd: '~/dev/cockpit',
      sourcePresetId: 'claude',
      sessions: [
        session('src', '~/dev/cockpit', { title: 'Current' }),
        session('other-dir', '~/dev/other', { presetId: 'codex', name: 'Codex', agent: 'codex' }),
        session('same-dir', '~/dev/cockpit/src', {
          presetId: 'agy',
          name: 'Antigravity CLI',
          agent: 'agy',
          title: 'Reviewing'
        }),
        session('shell', '~/dev/cockpit', { presetId: 'shell', name: 'Shell', agent: null }),
        session('exited', '~/dev/cockpit', { status: 'exited' })
      ],
      presets: DEFAULT_PRESETS
    })

    expect(groups).toHaveLength(2)
    expect(groups[0]).toEqual([
      {
        label: 'Reviewing · ~/dev/cockpit/src',
        target: { kind: 'pane', paneId: 'same-dir' }
      },
      {
        label: 'Codex · ~/dev/other',
        target: { kind: 'pane', paneId: 'other-dir' }
      }
    ])
    expect(groups[1]).toEqual([
      {
        label: 'New split: Codex',
        target: { kind: 'split', sourcePaneId: 'src', presetId: 'codex', cwd: '~/dev/cockpit' }
      },
      {
        label: 'New split: Antigravity CLI',
        target: { kind: 'split', sourcePaneId: 'src', presetId: 'agy', cwd: '~/dev/cockpit' }
      },
      {
        label: 'New split: Claude Code',
        target: { kind: 'split', sourcePaneId: 'src', presetId: 'claude', cwd: '~/dev/cockpit' }
      }
    ])
  })

  it('offers new tabs instead of splits when canSplit is false', () => {
    const groups = handoffChoices({
      sourcePaneId: 'src',
      sourceCwd: '~/dev/app',
      sourcePresetId: 'claude',
      sessions: [],
      presets: DEFAULT_PRESETS,
      canSplit: false
    })
    expect(groups).toHaveLength(1)
    expect(groups[0]?.[0]).toEqual({
      label: 'New tab: Codex',
      target: { kind: 'newTab', presetId: 'codex', cwd: '~/dev/app' }
    })
  })

  it('returns no groups when there are no other running agents and no agent presets', () => {
    const shellOnly: Preset[] = [{ id: 'shell', name: 'Shell', cwd: '~' }]
    expect(
      handoffChoices({
        sourcePaneId: 'src',
        sourceCwd: '~',
        sessions: [session('src', '~')],
        presets: shellOnly
      })
    ).toEqual([])
  })
})

describe('handoffMenuItems', () => {
  it('inserts separators between groups and maps every item id back to its target', () => {
    const groups = handoffChoices({
      sourcePaneId: 'src',
      sourceCwd: '~/dev/cockpit',
      sourcePresetId: 'claude',
      sessions: [session('p2', '~/dev/cockpit', { name: 'Codex', agent: 'codex' })],
      presets: DEFAULT_PRESETS
    })
    const { items, targets } = handoffMenuItems(groups, 'send')
    expect(items.map((i) => ('type' in i ? '---' : i.label))).toEqual([
      'Codex · ~/dev/cockpit',
      '---',
      'New split: Codex',
      'New split: Antigravity CLI',
      'New split: Claude Code'
    ])
    expect(targets.get('send:0')).toEqual({ kind: 'pane', paneId: 'p2' })
    expect(targets.get('send:1')).toEqual({
      kind: 'split',
      sourcePaneId: 'src',
      presetId: 'codex',
      cwd: '~/dev/cockpit'
    })
  })
})

describe('planReviewPrompt', () => {
  it('wraps a plan with a concise review prompt and avoids duplicating an existing heading', () => {
    const prompt = planReviewPrompt({
      title: 'Add caching',
      text: '# Add caching\n\n1. Add an LRU cache.',
      file: '/Users/me/.claude/plans/cache.md'
    })
    expect(prompt).toContain('Please review this implementation plan')
    expect(prompt).toContain('Plan file: /Users/me/.claude/plans/cache.md')
    expect(prompt.match(/# Add caching/g)).toHaveLength(1)
  })

  it('adds the title as a heading when the plan body has none', () => {
    const prompt = planReviewPrompt({
      title: 'Refactor auth',
      text: 'Move token validation into middleware.',
      file: null
    })
    expect(prompt).toContain('# Refactor auth\n\nMove token validation into middleware.')
    expect(prompt).not.toContain('Plan file:')
  })
})

describe('selectionPrompt', () => {
  it('preserves indentation, trims outer blank lines, and fences output safely', () => {
    const prompt = selectionPrompt('\n\n  const x = 1\n  return x\n\n', {
      sourceName: 'Claude Code'
    })
    expect(prompt).toBe('From Claude Code terminal output:\n\n```\n  const x = 1\n  return x\n```')
  })

  it('uses a longer fence when the selection contains triple backticks', () => {
    const prompt = selectionPrompt('```ts\nconst a = 1\n```')
    expect(prompt).toBe('From terminal output:\n\n````\n```ts\nconst a = 1\n```\n````')
  })
})

describe('defaultComparePresets', () => {
  it('picks two distinct agent presets, starting from the focused preset when it is an agent', () => {
    expect(defaultComparePresets(DEFAULT_PRESETS, 'codex')).toEqual(['codex', 'claude'])
    expect(defaultComparePresets(DEFAULT_PRESETS, 'shell')).toEqual(['claude', 'codex'])
    expect(defaultComparePresets(DEFAULT_PRESETS, null)).toEqual(['claude', 'codex'])
  })

  it('falls back gracefully when only one agent preset or no presets exist', () => {
    const oneAgent: Preset[] = [
      { id: 'shell', name: 'Shell', cwd: '~' },
      { id: 'claude', name: 'Claude Code', command: 'claude', cwd: '~' }
    ]
    expect(defaultComparePresets(oneAgent, null)).toEqual(['claude', 'claude'])
    expect(defaultComparePresets([], null)).toBeNull()
  })
})
