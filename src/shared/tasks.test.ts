import { describe, expect, it } from 'bun:test'
import {
  deletesBranch,
  mergedAndClean,
  readTaskSettings,
  removalWarnings,
  taskAt,
  validBranch,
  worktreeName,
  type TaskInfo
} from './tasks'

const task = (extra: Partial<TaskInfo> = {}): TaskInfo => ({
  path: '~/.cockpit/worktrees/app/x',
  repo: '~/dev/app',
  branch: 'x',
  head: 'h',
  changed: 0,
  unpushed: 0,
  pr: null,
  prError: null,
  inPr: false,
  createdAt: 0,
  ...extra
})

const merged = {
  number: 1,
  title: 't',
  url: 'u',
  state: 'merged' as const,
  draft: false,
  checks: null,
  review: null,
  head: 'h',
  base: 'main'
}

describe('validBranch', () => {
  it('takes what git takes', () => {
    for (const ok of ['main', 'feat/x', 'nick/sc-1234/fix-login', 'v1.2', 'a-b_c']) {
      expect(validBranch(ok), ok).toBe(true)
    }
    for (const bad of [
      '',
      'two words',
      '-x',
      '/x',
      'x/',
      'a..b',
      'a//b',
      'x.lock',
      'x.',
      '.x',
      'a/.b',
      'a~1',
      'a^',
      'a:b',
      'a?',
      'a*',
      'a[b',
      'a\\b',
      'a@{b',
      '@',
      'x'.repeat(201)
    ]) {
      expect(validBranch(bad), bad).toBe(false)
    }
  })
})

describe('worktreeName', () => {
  it('makes a folder name of a branch', () => {
    expect(worktreeName('nick/sc-12/fix-it')).toBe('nick-sc-12-fix-it')
    expect(worktreeName('feat/über--x')).toBe('feat-ber-x')
    expect(worktreeName('.hidden/')).toBe('hidden')
    expect(worktreeName('///')).toBe('task')
    expect(worktreeName('a'.repeat(100)).length).toBe(80)
  })
})

describe('taskAt', () => {
  it('finds the task a directory is in, not one that only shares a prefix', () => {
    const tasks = [{ path: '~/w/app/x' }, { path: '~/w/app/xy' }]
    expect(taskAt(tasks, '~/w/app/x')).toBe(tasks[0] ?? null)
    expect(taskAt(tasks, '~/w/app/x/src')).toBe(tasks[0] ?? null)
    expect(taskAt(tasks, '~/w/app/xy')).toBe(tasks[1] ?? null)
    expect(taskAt(tasks, '~/w/app')).toBeNull()
  })
})

describe('readTaskSettings', () => {
  it('keeps setup commands and paths inside the repository', () => {
    expect(
      readTaskSettings({
        '~/dev/app/': {
          setup: '  bun install  ',
          copy: ['.env', '../x', '/etc/passwd', 'a/./b', 'conf/', 3]
        },
        '~/dev/none': 'not an object',
        '~/dev/empty': { setup: '   ' }
      })
    ).toEqual({
      '~/dev/app': { setup: 'bun install', copy: ['.env', 'conf'] },
      '~/dev/empty': { copy: [] }
    })
    expect(readTaskSettings(null)).toEqual({})
    // Keys are paths, which rules out the prototype's.
    const parsed: unknown = JSON.parse('{"__proto__": {"setup": "x"}, "relative": {"setup": "x"}}')
    const read = readTaskSettings(parsed)
    expect(read).toEqual({})
    expect(Object.getPrototypeOf(read)).toBe(Object.prototype)
  })
})

describe('removal', () => {
  it('needs no question for a merged task with nothing newer and no terminals', () => {
    const t = task({ pr: merged, inPr: true, unpushed: 2 })
    expect(mergedAndClean(t)).toBe(true)
    expect(deletesBranch(t)).toBe(true)
    expect(removalWarnings(t, 0)).toEqual([])
    expect(removalWarnings(t, 2)).toEqual(['2 terminals in it will close.'])
  })

  it('says what is lost and what is kept otherwise', () => {
    expect(removalWarnings(task({ changed: 3, unpushed: 1 }), 1)).toEqual([
      "3 files have changes that aren't committed.",
      'The branch x is kept, with 1 commit on no remote.',
      '1 terminal in it will close.'
    ])
    expect(removalWarnings(task({ pr: merged, inPr: false, unpushed: 2 }), 0)).toEqual([
      "The branch x is kept: it has commits the merged pull request doesn't."
    ])
    expect(removalWarnings(task(), 0)).toEqual(['The branch x is kept.'])
    expect(removalWarnings(task({ branch: null, unpushed: 1 }), 0)).toEqual([
      "HEAD is detached, and 1 commit on it isn't on any branch or remote."
    ])
    expect(mergedAndClean(task({ pr: merged, inPr: true, changed: 1 }))).toBe(false)
  })
})
