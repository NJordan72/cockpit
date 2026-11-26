import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { ConfigStore } from './config'

let tmp: string
let prevHome: string | undefined

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ck-config-')))
  prevHome = process.env.COCKPIT_HOME
  process.env.COCKPIT_HOME = tmp
})

afterEach(() => {
  if (prevHome === undefined) delete process.env.COCKPIT_HOME
  else process.env.COCKPIT_HOME = prevHome
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('ConfigStore.saveSettings', () => {
  it('validates and writes settings patches atomically to config.json', () => {
    const store = new ConfigStore(() => undefined)
    const saved = store.saveSettings({
      editor: 'cursor',
      projectsDir: '~/src',
      terminal: { fontSize: 16 },
      tasks: { '~/src/app': { setup: 'pnpm install', copy: ['.env'] } },
      keybindings: { openSettings: 'Cmd+Shift+,' }
    })
    expect(saved.editor).toBe('cursor')
    expect(saved.projectsDir).toBe('~/src')
    expect(saved.terminal.fontSize).toBe(16)
    expect(saved.tasks).toEqual({ '~/src/app': { setup: 'pnpm install', copy: ['.env'] } })
    expect(saved.keybindings.openSettings).toBe('Cmd+Shift+,')

    const onDisk = JSON.parse(fs.readFileSync(path.join(tmp, 'config.json'), 'utf8')) as {
      editor: string | null
      projectsDir: string
      tasks: Record<string, { setup?: string; copy: string[] }>
    }
    expect(onDisk.editor).toBe('cursor')
    expect(onDisk.projectsDir).toBe('~/src')
    expect(onDisk.tasks).toEqual({ '~/src/app': { setup: 'pnpm install', copy: ['.env'] } })
  })
})
