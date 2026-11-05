import { describe, expect, it } from 'bun:test'
import type { Layout } from '@shared/config'
import { DEFAULT_PRESETS } from '@shared/config'
import type { PaneStatus } from '../agents/tracker'
import { listSessions, widgetSession } from './sessions'

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

describe('listSessions', () => {
  it('fills in each pane from its status, and marks panes without a process exited', () => {
    const list = listSessions(layout, DEFAULT_PRESETS, (id) => (id === 'pane-a' ? waiting : null))
    expect(list).toEqual([
      {
        id: 'pane-a',
        tabId: 'tab-1',
        presetId: 'claude',
        name: 'Claude Code',
        cwd: '~/dev/x',
        status: 'needs-input',
        since: 5,
        agent: 'claude',
        message: 'Claude needs permission to use Bash',
        title: 'Fix it',
        tokens: 100,
        focused: true
      },
      {
        id: 'pane-b',
        tabId: 'tab-1',
        presetId: 'shell',
        name: 'Shell',
        cwd: '~',
        status: 'exited',
        since: 0,
        agent: null,
        message: null,
        title: null,
        tokens: null,
        focused: false
      }
    ])
  })

  it('keeps what an agent is waiting for away from widgets', () => {
    const [first] = listSessions(layout, DEFAULT_PRESETS, () => waiting)
    if (!first) throw new Error('no session')
    const shared = widgetSession(first)
    expect('message' in shared).toBe(false)
    expect(shared.status).toBe('needs-input')
  })
})
