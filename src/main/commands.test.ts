import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { suggestName } from '@shared/commands'
import { deleteCommand, formatCommand, listCommands, parseCommand, saveCommand } from './commands'

let home: string

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'cockpit-commands-'))
})

afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true })
})

describe('command files', () => {
  it('round-trips a description and body', () => {
    const text = formatCommand('Fix the "lint" errors\n', 'Fix lint: "all" of it')
    expect(parseCommand(text)).toEqual({
      description: 'Fix lint: "all" of it',
      body: 'Fix the "lint" errors'
    })
    expect(parseCommand('just a prompt\n')).toEqual({ description: null, body: 'just a prompt' })
  })

  it('saves, refuses to overwrite unless asked, lists, and deletes global commands', async () => {
    const req = { name: 'tidy', scope: 'global' as const, body: 'Tidy up', cwd: home }
    expect(await saveCommand(req, home)).toMatchObject({ ok: true })
    expect(await saveCommand(req, home)).toMatchObject({ ok: false, exists: true })
    expect(await saveCommand({ ...req, body: 'Again', overwrite: true }, home)).toMatchObject({
      ok: true
    })
    const list = await listCommands(home, home)
    expect(list.repo).toBeNull()
    expect(list.commands).toMatchObject([{ name: 'tidy', scope: 'global', body: 'Again' }])
    expect(await deleteCommand(home, 'tidy', 'global', home)).toBe(true)
    expect((await listCommands(home, home)).commands).toEqual([])
  })

  it('refuses bad names and repo commands outside a repo', async () => {
    const req = { scope: 'global' as const, body: 'x', cwd: home }
    expect(await saveCommand({ ...req, name: '../evil' }, home)).toMatchObject({ ok: false })
    expect(await saveCommand({ ...req, name: 'ok', scope: 'repo' }, home)).toMatchObject({
      ok: false,
      error: 'This pane is not in a git repository'
    })
    expect(await deleteCommand(home, '../x', 'global', home)).toBe(false)
  })
})

describe('suggestName', () => {
  it('makes a name from the first words', () => {
    expect(suggestName('Run the tests, then fix what fails!')).toBe('run-the-tests-then')
  })
})
