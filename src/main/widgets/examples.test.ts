// The example widgets in examples/widgets/, which live outside src/.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'bun:test'
import { checkGraph } from '@shared/runs'
import { parseManifest, sessionsAllow } from './manifest'

const EXAMPLES = path.resolve(import.meta.dir, '../../../examples/widgets')

describe('example widgets', () => {
  it('have manifests that load', () => {
    const ids = fs
      .readdirSync(EXAMPLES)
      .filter((name) => fs.existsSync(path.join(EXAMPLES, name, 'widget.json')))
    expect(ids).toContain('shortcut-stories')
    for (const id of ids) {
      const raw: unknown = JSON.parse(
        fs.readFileSync(path.join(EXAMPLES, id, 'widget.json'), 'utf8')
      )
      expect(() => parseManifest(raw, id), id).not.toThrow()
    }
  })

  it('let Shortcut Stories label sessions', () => {
    const raw: unknown = JSON.parse(
      fs.readFileSync(path.join(EXAMPLES, 'shortcut-stories', 'widget.json'), 'utf8')
    )
    const { permissions } = parseManifest(raw, 'shortcut-stories').manifest
    expect(sessionsAllow(permissions.sessions, 'label')).toBe(true)
  })
})

describe("Shortcut Stories' branch matching", () => {
  const scope: { shortcutStoryId?: (branch: unknown) => number | null } = {}
  vm.runInNewContext(
    fs.readFileSync(path.join(EXAMPLES, 'shortcut-stories', 'branch.js'), 'utf8'),
    scope
  )
  const storyId = (branch: unknown): number | null => {
    if (!scope.shortcutStoryId) throw new Error('branch.js defined no shortcutStoryId')
    return scope.shortcutStoryId(branch)
  }

  it('finds the story a branch names', () => {
    expect(storyId('nick/sc-1234/fix-login')).toBe(1234)
    expect(storyId('sc-1234')).toBe(1234)
    expect(storyId('sc-1234-fix-login')).toBe(1234)
    expect(storyId('feature/SC-42_login')).toBe(42)
    expect(storyId('nick/sc-1/and-sc-2')).toBe(1)
  })

  it('finds nothing in branches that only look close', () => {
    for (const branch of [
      'main',
      'disc-12',
      'nick/sc-12b/x',
      'sc-',
      'sc-x/12',
      'nick/misc-7',
      ''
    ]) {
      expect(storyId(branch), branch).toBeNull()
    }
    expect(storyId(null)).toBeNull()
  })
})

describe("Shortcut Stories' Burn down epic", () => {
  interface Story {
    id: number
    name: string
    app_url: string
    workflow_state_id: number
    archived?: boolean
    story_links: { verb: string; subject_id: number; object_id: number }[]
  }
  const scope: { shortcutEpicRun?: (input: unknown) => unknown } = {}
  vm.runInNewContext(
    fs.readFileSync(path.join(EXAMPLES, 'shortcut-stories', 'epic.js'), 'utf8'),
    scope
  )
  const DONE = 9
  const OPEN = 1
  const run = (stories: Story[], outside: Record<number, Story> = {}): unknown => {
    if (!scope.shortcutEpicRun) throw new Error('epic.js defined no shortcutEpicRun')
    return scope.shortcutEpicRun({
      epic: { id: 200, name: 'Example epic' },
      stories,
      outside,
      isDone: (state: number) => state === DONE,
      branch: (s: Story) => `feature/sc-${String(s.id)}/x`,
      prompt: (s: Story) => `Work on Shortcut story sc-${String(s.id)}`
    })
  }
  // An eight-story epic's `blocks` links, each listed on both of its stories as the API does.
  const blocks: [number, number][] = [
    [201, 202],
    [201, 204],
    [202, 203],
    [203, 207],
    [203, 206],
    [204, 205],
    [204, 208],
    [206, 208]
  ]
  const story = (id: number, state = OPEN): Story => ({
    id,
    name: `Story ${String(id)}`,
    app_url: `https://app.shortcut.com/acme/story/${String(id)}`,
    workflow_state_id: state,
    story_links: blocks
      .filter(([a, b]) => a === id || b === id)
      .map(([a, b]) => ({ verb: 'blocks', subject_id: a, object_id: b }))
  })
  const ids = [201, 206, 208, 204, 205, 203, 207, 202]

  it('makes each open story an item that waits on the stories blocking it', () => {
    const graph = run(ids.map((id) => story(id))) as {
      title: string
      items: { id: string; after: string[]; branch: string; url: string }[]
    }
    expect(graph.title).toBe('Epic 200: Example epic')
    expect(checkGraph(graph).ok).toBe(true)
    expect(Object.fromEntries(graph.items.map((i) => [i.id, i.after]))).toEqual({
      'sc-201': [],
      'sc-206': ['sc-203'],
      'sc-208': ['sc-204', 'sc-206'],
      'sc-204': ['sc-201'],
      'sc-205': ['sc-204'],
      'sc-203': ['sc-202'],
      'sc-207': ['sc-203'],
      'sc-202': ['sc-201']
    })
    expect(graph.items[0]).toMatchObject({
      branch: 'feature/sc-201/x',
      url: 'https://app.shortcut.com/acme/story/201'
    })
  })

  it('leaves out done stories, and waits on a blocker outside the epic until it is done', () => {
    const stories = ids.map((id) => story(id, id === 201 ? DONE : OPEN))
    const first = stories.find((s) => s.id === 202)
    first?.story_links.push({ verb: 'blocks', subject_id: 90, object_id: 202 })
    const graph = run(stories, { 90: { ...story(90), name: 'Publish the tokens' } }) as {
      items: { id: string; title: string; after?: string[]; external?: boolean; url?: string }[]
    }
    expect(graph.items.map((i) => i.id)).not.toContain('sc-201')
    expect(graph.items.find((i) => i.id === 'sc-202')?.after).toEqual(['sc-90'])
    expect(graph.items.find((i) => i.id === 'sc-90')).toEqual({
      id: 'sc-90',
      title: 'Publish the tokens',
      external: true,
      url: 'https://app.shortcut.com/acme/story/90'
    })
    const doneOutside = run(stories, { 90: story(90, DONE) }) as {
      items: { id: string; after?: string[] }[]
    }
    expect(doneOutside.items.find((i) => i.id === 'sc-202')?.after).toEqual([])
    expect(checkGraph(graph).ok).toBe(true)
    // A blocker that couldn't be read is waited on.
    const unread = run(stories) as { items: { id: string; title: string }[] }
    expect(unread.items.find((i) => i.id === 'sc-90')?.title).toBe('Story 90')
  })
})
