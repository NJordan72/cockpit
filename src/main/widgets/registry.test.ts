import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WidgetInfo } from '@shared/widgets'
import { WidgetRegistry } from './registry'

let tmp: string
let widgetsDir: string
let changes: WidgetInfo[][]
let registry: WidgetRegistry

function makeWidget(dir: string, id: string, extra: Record<string, unknown> = {}): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'widget.json'), JSON.stringify({ id, name: id, ...extra }))
  fs.writeFileSync(path.join(dir, 'index.html'), '<p>hi</p>')
}

// FSEvents can drop changes made in the first moments after a watch starts.
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 300))

const waitFor = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 20))
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-registry-')))
  widgetsDir = path.join(tmp, 'widgets')
  fs.mkdirSync(widgetsDir)
  changes = []
  registry = new WidgetRegistry(widgetsDir, (list) => changes.push(list))
})

afterEach(() => {
  registry.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('WidgetRegistry', () => {
  it('loads folders and follows symlinks to them', () => {
    makeWidget(path.join(widgetsDir, 'plain'), 'plain')
    makeWidget(path.join(tmp, 'repo', 'linked'), 'linked')
    fs.symlinkSync(path.join(tmp, 'repo', 'linked'), path.join(widgetsDir, 'linked'))
    fs.writeFileSync(path.join(widgetsDir, 'README.md'), 'not a widget')
    registry.start()
    const list = registry.list()
    expect(list.map((w) => [w.id, w.error])).toEqual([
      ['linked', null],
      ['plain', null]
    ])
    expect(registry.get('linked')?.root).toBe(path.join(tmp, 'repo', 'linked'))
  })

  it('explains why a widget could not load', () => {
    makeWidget(path.join(widgetsDir, 'wrong-id'), 'other-id')
    makeWidget(path.join(widgetsDir, 'no-entry'), 'no-entry', { entry: 'app.html' })
    fs.mkdirSync(path.join(widgetsDir, 'empty'), { recursive: true })
    fs.mkdirSync(path.join(widgetsDir, 'bad-json'), { recursive: true })
    fs.writeFileSync(path.join(widgetsDir, 'bad-json', 'widget.json'), '{')
    fs.symlinkSync(path.join(tmp, 'gone'), path.join(widgetsDir, 'dangling'))
    registry.start()
    const errors = Object.fromEntries(registry.list().map((w) => [w.id, w.error]))
    expect(errors['wrong-id']).toMatch(/folder is named "wrong-id"/)
    expect(errors['no-entry']).toMatch(/"app.html" not found/)
    expect(errors.empty).toMatch(/no widget.json/)
    expect(errors['bad-json']).toMatch(/not valid JSON/)
    expect(errors.dangling).toMatch(/broken symlink/)
    expect(registry.get('wrong-id')?.parsed).toBeNull()
  })

  it('bumps the revision when a file in a linked widget changes', async () => {
    const repo = path.join(tmp, 'repo', 'live')
    makeWidget(repo, 'live')
    fs.symlinkSync(repo, path.join(widgetsDir, 'live'))
    registry.start()
    expect(registry.get('live')?.info.revision).toBe(1)
    await settle()
    fs.writeFileSync(path.join(repo, 'index.html'), '<p>changed</p>')
    await waitFor(() => changes.length > 0)
    expect(registry.get('live')?.info.revision).toBe(2)
  })

  it('notices widgets being added and removed', async () => {
    registry.start()
    await settle()
    makeWidget(path.join(widgetsDir, 'late'), 'late')
    await waitFor(() => registry.list().length === 1)
    expect(registry.list()[0]?.id).toBe('late')
    // Finding "late" starts a watch on its folder, which restarts the FSEvents
    // stream that every watch shares, so a removal right away can be missed.
    await settle()
    fs.rmSync(path.join(widgetsDir, 'late'), { recursive: true })
    await waitFor(() => registry.list().length === 0)
    expect(registry.list()).toEqual([])
  })
})
