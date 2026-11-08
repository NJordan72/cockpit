import { describe, expect, it } from 'bun:test'
import type { PaneSession } from '@shared/ipc'
import { prFields, taskFields } from '@shared/itemActions'
import { actionMenu } from './itemActions'

const session = (extra: Partial<PaneSession> = {}): PaneSession => ({
  id: 'p1',
  tabId: 't',
  presetId: 'claude',
  name: 'Claude Code',
  cwd: '~/dev/app',
  branch: null,
  status: 'idle',
  since: 0,
  agent: 'claude',
  title: null,
  tokens: null,
  focused: true,
  message: null,
  labels: [],
  ...extra
})

const pr = prFields({
  number: 123,
  url: 'https://github.com/o/r/pull/123',
  title: 'T',
  branch: 'b',
  author: 'a'
})

describe('actionMenu', () => {
  it('makes an entry with a target one click, and one without a submenu', () => {
    const menu = actionMenu(
      'pr',
      [
        { label: 'Propose ship', command: '/propose-ship {number}', target: 'here' },
        { label: 'Review', command: '/code-review' }
      ],
      pr,
      { here: session() }
    )
    expect(menu.items).toEqual([
      { type: 'separator' },
      { id: 'action:0:here', label: 'Propose ship', enabled: true },
      {
        label: 'Review',
        submenu: [
          { id: 'action:1:new', label: 'In a new session', enabled: true },
          { id: 'action:1:here', label: 'In this session', enabled: true }
        ]
      }
    ])
    expect(menu.pick('action:0:here')).toEqual({
      prompt: '/propose-ship 123',
      target: { kind: 'pane', paneId: 'p1' }
    })
    expect(menu.pick('action:1:new')).toEqual({
      prompt: '/code-review https://github.com/o/r/pull/123',
      target: { kind: 'new' }
    })
    expect(menu.pick('copy')).toBeNull()
    expect(menu.pick(null)).toBeNull()
  })

  it('disables this session when its agent has exited or there is none', () => {
    const actions = [{ label: 'Ship', command: '/ship {number}', target: 'here' as const }]
    for (const here of [session({ status: 'exited' }), session({ agent: null }), null]) {
      const menu = actionMenu('pr', actions, pr, { here })
      expect(menu.items[1]).toMatchObject({ enabled: false })
      expect(menu.pick('action:0:here')).toBeNull()
    }
  })

  it("leaves out an entry whose command needs a field the item doesn't have", () => {
    const task = taskFields({ path: '~/w/a', repo: '~/dev/app', branch: 'a', pr: null })
    const menu = actionMenu(
      'task',
      [
        { label: 'Ship', command: '/ship-pr {pr.number}', target: 'worktree' },
        { label: 'Status', command: 'What is left on {branch}?' }
      ],
      task,
      { here: session(), worktree: '~/w/a', presetId: 'codex' }
    )
    expect(menu.items).toEqual([
      { type: 'separator' },
      {
        label: 'Status',
        submenu: [
          { id: 'action:1:worktree', label: 'In its worktree', enabled: true },
          { id: 'action:1:new', label: 'In a new session', enabled: true },
          { id: 'action:1:here', label: 'In this session', enabled: true }
        ]
      }
    ])
    expect(menu.pick('action:0:worktree')).toBeNull()
    expect(menu.pick('action:1:worktree')).toEqual({
      prompt: 'What is left on a?',
      target: { kind: 'worktree', path: '~/w/a', presetId: 'codex' }
    })
    // Nothing applies, so not even the separator shows.
    expect(actionMenu('pr', [], pr, { here: null }).items).toEqual([])
  })

  it('disables the worktree until the item has one', () => {
    const task = taskFields({ path: '~/w/a', repo: '~/dev/app', branch: 'a', pr: null })
    const menu = actionMenu('task', [{ label: 'Go', command: 'Go', target: 'worktree' }], task, {
      here: null,
      worktree: null
    })
    expect(menu.items[1]).toEqual({ id: 'action:0:worktree', label: 'Go', enabled: false })
    expect(menu.pick('action:0:worktree')).toBeNull()
  })
})
