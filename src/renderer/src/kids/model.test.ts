import { describe, expect, it } from 'vitest'
import type { KidsCharacter } from '@shared/ipc'
import {
  LETTERS,
  letterForCode,
  letterPhrase,
  noteForCode,
  pentatonic,
  randomSprite,
  SongPlayer,
  SONGS,
  spriteForLetter,
  WordWatcher
} from './model'

const letters = (s: string): string[] => Array.from(s)

const char = (name: string, letter: string | null): KidsCharacter => ({
  name,
  letter,
  src: `data:image/png;base64,${name}`
})

describe('WordWatcher', () => {
  it('fires when the last letters spell the word', () => {
    const w = new WordWatcher('grownup')
    const fired = letters('xxgrowgrownup').map((l) => w.push(l))
    expect(fired.lastIndexOf(true)).toBe(12)
    expect(fired.filter(Boolean)).toHaveLength(1)
  })

  it('needs the letters in order', () => {
    const w = new WordWatcher('grownup')
    expect(letters('grownpu').some((l) => w.push(l))).toBe(false)
  })
})

describe('sprites', () => {
  it('has an emoji for every letter', () => {
    expect(Object.keys(LETTERS)).toHaveLength(26)
  })

  it("uses the user's picture for its letter, otherwise the emoji", () => {
    const chars = [char('Bluey', 'b'), char('Bingo', 'b'), char('Elsa', 'e')]
    expect(spriteForLetter('b', chars, () => 0.9)).toMatchObject({ kind: 'image', name: 'Bingo' })
    expect(spriteForLetter('e', chars, () => 0)).toMatchObject({ kind: 'image', name: 'Elsa' })
    expect(spriteForLetter('c', chars, () => 0)).toEqual({ kind: 'emoji', text: '🐱', name: 'cat' })
  })

  it('picks random sprites from pictures when there are any', () => {
    expect(randomSprite([char('Elsa', 'e')], () => 0)).toMatchObject({ kind: 'image' })
    expect(randomSprite([], () => 0)).toMatchObject({ kind: 'emoji' })
    // 30% of the time it's an emoji anyway.
    expect(randomSprite([char('Elsa', 'e')], () => 0.95)).toMatchObject({ kind: 'emoji' })
  })

  it('says what the letter is for', () => {
    expect(letterPhrase('b', { kind: 'image', src: '', name: 'Bluey' })).toBe('B is for Bluey')
    expect(letterPhrase('x', { kind: 'emoji', text: '🦊', name: 'fox' })).toBe('X is in fox')
  })
})

describe('music', () => {
  it('plays each song through, then the next', () => {
    const p = new SongPlayer()
    const first = SONGS[0]?.notes ?? []
    const second = SONGS[1]?.notes ?? []
    const played = Array.from({ length: first.length + 3 }, () => p.next())
    expect(played.slice(0, first.length)).toEqual(first)
    expect(played.slice(first.length)).toEqual(second.slice(0, 3))
  })

  it('keeps songs within a singable range', () => {
    for (const song of SONGS) {
      expect(Math.min(...song.notes)).toBeGreaterThanOrEqual(55)
      expect(Math.max(...song.notes)).toBeLessThanOrEqual(72)
    }
  })

  it('walks the pentatonic scale', () => {
    expect([0, 1, 2, 3, 4, 5].map(pentatonic)).toEqual([60, 62, 64, 67, 69, 72])
  })

  it('goes up left to right and row by row', () => {
    expect(noteForCode('KeyZ')).toBe(60)
    expect(noteForCode('KeyX')).toBe(62)
    expect(noteForCode('KeyA')).toBe(62)
    expect(noteForCode('KeyQ')).toBe(64)
    expect(noteForCode('Digit1')).toBe(69)
    expect(noteForCode('Equal')).toBe(96)
    expect(noteForCode('Enter')).toBeNull()
  })

  it('reads letters from physical keys', () => {
    expect(letterForCode('KeyQ')).toBe('q')
    expect(letterForCode('Digit1')).toBeNull()
  })
})
