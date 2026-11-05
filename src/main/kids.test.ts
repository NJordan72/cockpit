import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { listCharacters, MAX_FILE_BYTES } from './kids'

let tmp: string

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-kids-')))
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('listCharacters', () => {
  it('creates the folder when it is missing', async () => {
    const dir = path.join(tmp, 'kids')
    expect(await listCharacters(dir)).toEqual([])
    expect(fs.statSync(dir).isDirectory()).toBe(true)
  })

  it('reads images as data URLs, named and lettered from the file name', async () => {
    fs.writeFileSync(path.join(tmp, 'peppa_pig.PNG'), 'png')
    fs.writeFileSync(path.join(tmp, 'Bluey.gif'), 'gif')
    fs.writeFileSync(path.join(tmp, '2-dogs.webp'), 'webp')
    const list = await listCharacters(tmp)
    expect(list.map((c) => [c.name, c.letter])).toEqual([
      ['2 dogs', null],
      ['Bluey', 'b'],
      ['peppa pig', 'p']
    ])
    expect(list[1]?.src).toBe(`data:image/gif;base64,${Buffer.from('gif').toString('base64')}`)
  })

  it('skips other files, hidden files, folders, and files that are too big', async () => {
    fs.writeFileSync(path.join(tmp, 'notes.txt'), 'x')
    fs.writeFileSync(path.join(tmp, '.hidden.png'), 'x')
    fs.mkdirSync(path.join(tmp, 'folder.png'))
    fs.writeFileSync(path.join(tmp, 'huge.png'), Buffer.alloc(MAX_FILE_BYTES + 1))
    fs.writeFileSync(path.join(tmp, 'ok.png'), 'x')
    expect((await listCharacters(tmp)).map((c) => c.name)).toEqual(['ok'])
  })

  it('follows symlinks and skips broken ones', async () => {
    const real = path.join(tmp, 'elsewhere')
    fs.mkdirSync(real)
    fs.writeFileSync(path.join(real, 'elsa.png'), 'x')
    const dir = path.join(tmp, 'kids')
    fs.mkdirSync(dir)
    fs.symlinkSync(path.join(real, 'elsa.png'), path.join(dir, 'Elsa.png'))
    fs.symlinkSync(path.join(real, 'gone.png'), path.join(dir, 'gone.png'))
    expect((await listCharacters(dir)).map((c) => c.name)).toEqual(['Elsa'])
  })
})
