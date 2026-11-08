// The example widgets in examples/widgets/, which live outside src/.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'bun:test'
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
