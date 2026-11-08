import { describe, expect, it } from 'bun:test'
import {
  fileFields,
  itemPrompt,
  MAX_ITEM_ACTIONS,
  prFields,
  readActionList,
  readItemActions,
  runItemFields,
  taskFields
} from './itemActions'
import type { RunItemView } from './runs'
import type { TaskPr } from './tasks'

const pr = prFields({
  number: 123,
  url: 'https://github.com/o/r/pull/123',
  title: 'Fix the thing',
  branch: 'nick/fix',
  author: 'nick'
})

const taskPr: TaskPr = {
  number: 7,
  title: 'Task PR',
  url: 'https://github.com/o/r/pull/7',
  state: 'open',
  draft: false,
  checks: null,
  review: null,
  head: 'abc',
  base: 'main'
}

const itemState: RunItemView['state'] = {
  phase: 'review',
  waitingOn: [],
  startsOn: null,
  agent: null,
  path: '~/.cockpit/worktrees/r-a',
  pr: taskPr,
  mergedInto: null,
  baseMerged: false,
  reason: null
}

describe('itemPrompt', () => {
  it('fills in placeholders from the item', () => {
    expect(itemPrompt('pr', '/propose-ship {number}', pr)).toBe('/propose-ship 123')
    expect(itemPrompt('pr', 'Look at {repo}#{number}, "{title}" on {branch} by {author}', pr)).toBe(
      'Look at o/r#123, "Fix the thing" on nick/fix by nick'
    )
    expect(itemPrompt('pr', '/code-review {url} {url}', pr)).toBe(
      '/code-review https://github.com/o/r/pull/123 https://github.com/o/r/pull/123'
    )
  })

  it("adds the item's URL or path to a command without placeholders", () => {
    expect(itemPrompt('pr', '/code-review', pr)).toBe(
      '/code-review https://github.com/o/r/pull/123'
    )
    expect(itemPrompt('file', 'Explain', fileFields('/a/b.ts'))).toBe('Explain /a/b.ts')
  })

  it('leaves braces around words that are no placeholder of the kind', () => {
    // {path} belongs to tasks, not pull requests, so the URL still goes on the end.
    expect(itemPrompt('pr', 'Use {path} and {nope}', pr)).toBe(
      'Use {path} and {nope} https://github.com/o/r/pull/123'
    )
    expect(itemPrompt('pr', 'Ship {number} as {json: true}', pr)).toBe('Ship 123 as {json: true}')
  })

  it('gives nothing when the item lacks a field the command uses', () => {
    const task = taskFields({ path: '~/w/a', repo: '~/dev/r', branch: null, pr: null })
    expect(itemPrompt('task', '/ship-pr {pr.number}', task)).toBeNull()
    expect(itemPrompt('task', 'On {branch}', task)).toBeNull()
    expect(itemPrompt('task', 'Tidy', task)).toBe('Tidy ~/w/a')
    const elsewhere = prFields({
      number: 1,
      url: 'https://gitlab.test/o/r/-/merge_requests/1',
      title: 'T',
      branch: 'b',
      author: 'a'
    })
    expect(itemPrompt('pr', 'In {repo}', elsewhere)).toBeNull()
  })
})

describe('item fields', () => {
  it("reads a task's pull request", () => {
    const task = taskFields({ path: '~/w/a', repo: '~/dev/r', branch: 'a', pr: taskPr })
    expect(task).toEqual({
      path: '~/w/a',
      repo: '~/dev/r',
      branch: 'a',
      'pr.number': '7',
      'pr.url': 'https://github.com/o/r/pull/7'
    })
  })

  it("reads a run item's pull request, and an external item's from its URL", () => {
    const item: RunItemView = {
      id: 'sc-1',
      title: 'One',
      branch: 'nick/sc-1',
      prompt: 'Do it',
      after: [],
      url: 'https://app.shortcut.com/s/story/1',
      state: itemState
    }
    expect(runItemFields(item)).toEqual({
      id: 'sc-1',
      title: 'One',
      branch: 'nick/sc-1',
      url: 'https://app.shortcut.com/s/story/1',
      'pr.number': '7',
      'pr.url': 'https://github.com/o/r/pull/7'
    })
    const external: RunItemView = {
      id: 'sc-2',
      title: 'Two',
      external: true,
      pr: 'https://github.com/o/r/pull/9',
      state: { ...itemState, phase: 'waiting', path: null, pr: null }
    }
    expect(runItemFields(external)).toEqual({
      id: 'sc-2',
      title: 'Two',
      branch: null,
      url: null,
      'pr.number': '9',
      'pr.url': 'https://github.com/o/r/pull/9'
    })
  })
})

describe('readItemActions', () => {
  it('keeps entries with a label and a command', () => {
    expect(
      readActionList(
        [
          { label: ' Ship ', command: ' /ship-pr ' },
          { label: '', command: '/x' },
          { label: 'No command' },
          'Review'
        ],
        'pr'
      )
    ).toEqual([{ label: 'Ship', command: '/ship-pr' }])
    const many = Array.from({ length: 30 }, (_, i) => ({ label: `A${String(i)}`, command: '/a' }))
    expect(readActionList(many, 'file')).toHaveLength(MAX_ITEM_ACTIONS)
  })

  it('keeps a target the kind can use and drops the rest', () => {
    const list = [
      { label: 'Here', command: '/a', target: 'here' },
      { label: 'New', command: '/a', target: 'new' },
      { label: 'Tree', command: '/a', target: 'worktree' },
      { label: 'Odd', command: '/a', target: 'elsewhere' }
    ]
    expect(readActionList(list, 'task').map((a) => a.target)).toEqual([
      'here',
      'new',
      'worktree',
      undefined
    ])
    // A pull request row or a file has no worktree of its own.
    expect(readActionList(list, 'pr').map((a) => a.target)).toEqual([
      'here',
      'new',
      undefined,
      undefined
    ])
  })

  it('defaults to a review of each pull request and nothing else', () => {
    expect(readItemActions(undefined)).toEqual({
      pr: [{ label: 'Review', command: '/code-review' }],
      task: [],
      runItem: [],
      file: []
    })
    // A kind left out keeps its default; an empty list turns it off.
    expect(
      readItemActions({ pr: [], task: [{ label: 'Ship', command: '/ship-pr {pr.number}' }] })
    ).toEqual({
      pr: [],
      task: [{ label: 'Ship', command: '/ship-pr {pr.number}' }],
      runItem: [],
      file: []
    })
  })

  it('takes the pull request entries from prActions until itemActions has them', () => {
    const prActions = [{ label: 'Ship', command: '/ship-pr' }]
    expect(readItemActions(undefined, prActions).pr).toEqual(prActions)
    expect(readItemActions({ task: [] }, prActions).pr).toEqual(prActions)
    expect(readItemActions({ pr: [] }, prActions).pr).toEqual([])
    expect(readItemActions(undefined, 'x').pr).toEqual([
      { label: 'Review', command: '/code-review' }
    ])
  })
})
