import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'bun:test'
import { existingPaths, resolveIn } from './files'

describe('resolveIn', () => {
  it('resolves relative, absolute, and home paths', () => {
    expect(resolveIn('/repo', 'src/a.ts')).toBe('/repo/src/a.ts')
    expect(resolveIn('/repo', '/etc/hosts')).toBe('/etc/hosts')
    expect(resolveIn('/repo', '~/x')).toBe(path.join(os.homedir(), 'x'))
  })
})

describe('existingPaths', () => {
  it('keeps only paths that exist under the directory', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-files-'))
    fs.mkdirSync(path.join(dir, 'slides'))
    fs.writeFileSync(path.join(dir, 'index.html'), '')
    const found = await existingPaths(dir, ['slides/', 'index.html', 'missing.md', dir])
    expect(found).toEqual(['slides/', 'index.html', dir])
  })
})
