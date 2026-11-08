import { describe, expect, it } from 'bun:test'
import type { Layout } from '@shared/config'
import { DEFAULT_PRESETS } from '@shared/config'
import type { PaneLabel } from '@shared/widgets'
import type { PaneStatus } from '../agents/tracker'
import { listSessions, widgetSession, type PaneLookup } from './sessions'

const layout: Layout = {
  tabs: [
    {
      id: 'tab-1',
      root: {
        type: 'split',
        id: 'split-1',
        direction: 'row',
        sizes: [0.5, 0.5],
        children: [
          { type: 'pane', id: 'pane-a', presetId: 'claude', cwd: '~/dev/x' },
          { type: 'pane', id: 'pane-b', presetId: 'shell', cwd: '~' }
        ]
      },
      activePaneId: 'pane-a'
    }
  ],
  activeTabId: 'tab-1'
}

const waiting: PaneStatus = {
  status: 'needs-input',
  since: 5,
  agent: 'claude',
  message: 'Claude needs permission to use Bash',
  title: 'Fix it',
  tokens: 100,
  doneMessage: null
}

const story: PaneLabel = {
  widgetId: 'shortcut-stories',
  widgetName: 'Shortcut Stories',
  key: 'SC-1234',
  title: 'Fix the login',
  facts: ['3 pts'],
  detail: null,
  url: 'https://app.shortcut.com/x/story/1234'
}

const lookup: PaneLookup = {
  status: (id) => (id === 'pane-a' ? waiting : null),
  branch: (id) => (id === 'pane-a' ? 'nick/sc-1234/fix-login' : null),
  labels: (id) => (id === 'pane-a' ? [story] : [])
}

describe('listSessions', () => {
  it('fills in each pane from its status, and marks panes without a process exited', () => {
    const list = listSessions(layout, DEFAULT_PRESETS, lookup)
    expect(list).toEqual([
      {
        id: 'pane-a',
        tabId: 'tab-1',
        presetId: 'claude',
        name: 'Claude Code',
        cwd: '~/dev/x',
        branch: 'nick/sc-1234/fix-login',
        status: 'needs-input',
        since: 5,
        agent: 'claude',
        message: 'Claude needs permission to use Bash',
        title: 'Fix it',
        tokens: 100,
        focused: true,
        labels: [story]
      },
      {
        id: 'pane-b',
        tabId: 'tab-1',
        presetId: 'shell',
        name: 'Shell',
        cwd: '~',
        branch: null,
        status: 'exited',
        since: 0,
        agent: null,
        message: null,
        title: null,
        tokens: null,
        focused: false,
        labels: []
      }
    ])
  })

  it("keeps what an agent is waiting for, and widgets' labels, away from widgets", () => {
    const [first] = listSessions(layout, DEFAULT_PRESETS, lookup)
    if (!first) throw new Error('no session')
    const shared = widgetSession(first)
    expect('message' in shared).toBe(false)
    expect('labels' in shared).toBe(false)
    expect(shared.status).toBe('needs-input')
    expect(shared.branch).toBe('nick/sc-1234/fix-login')
  })
})
