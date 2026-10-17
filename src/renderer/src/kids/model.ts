// What keys do in kids mode: the letter table, the songs, and the note each
// key plays. Pure, so it can be unit tested.
import type { KidsCharacter } from '@shared/ipc'

export type Sprite =
  { kind: 'emoji'; text: string; name: string } | { kind: 'image'; src: string; name: string }

export const LETTERS: Record<string, { emoji: string; word: string }> = {
  a: { emoji: '🐊', word: 'alligator' },
  b: { emoji: '🐻', word: 'bear' },
  c: { emoji: '🐱', word: 'cat' },
  d: { emoji: '🐶', word: 'dog' },
  e: { emoji: '🐘', word: 'elephant' },
  f: { emoji: '🐸', word: 'frog' },
  g: { emoji: '🦒', word: 'giraffe' },
  h: { emoji: '🐴', word: 'horse' },
  i: { emoji: '🍦', word: 'ice cream' },
  j: { emoji: '🪼', word: 'jellyfish' },
  k: { emoji: '🦘', word: 'kangaroo' },
  l: { emoji: '🦁', word: 'lion' },
  m: { emoji: '🐵', word: 'monkey' },
  n: { emoji: '👃', word: 'nose' },
  o: { emoji: '🐙', word: 'octopus' },
  p: { emoji: '🐧', word: 'penguin' },
  q: { emoji: '👸', word: 'queen' },
  r: { emoji: '🐰', word: 'rabbit' },
  s: { emoji: '🐌', word: 'snail' },
  t: { emoji: '🐯', word: 'tiger' },
  u: { emoji: '🦄', word: 'unicorn' },
  v: { emoji: '🌋', word: 'volcano' },
  w: { emoji: '🐳', word: 'whale' },
  x: { emoji: '🦊', word: 'fox' },
  y: { emoji: '🪀', word: 'yo-yo' },
  z: { emoji: '🦓', word: 'zebra' }
}

const NUMBER_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine'
]

export type Rand = () => number

const pick = <T>(items: readonly T[], rand: Rand): T | undefined =>
  items[Math.floor(rand() * items.length)]

const imageSprite = (c: KidsCharacter): Sprite => ({ kind: 'image', src: c.src, name: c.name })

const emojiSprite = (letter: string): Sprite => {
  const l = LETTERS[letter] ?? { emoji: '⭐', word: 'star' }
  return { kind: 'emoji', text: l.emoji, name: l.word }
}

/** The user's picture for this letter if there is one, otherwise the letter's emoji. */
export function spriteForLetter(letter: string, characters: KidsCharacter[], rand: Rand): Sprite {
  const own = pick(
    characters.filter((c) => c.letter === letter),
    rand
  )
  return own ? imageSprite(own) : emojiSprite(letter)
}

/** Mostly the user's pictures, when there are any. */
export function randomSprite(characters: KidsCharacter[], rand: Rand): Sprite {
  const own = rand() < 0.7 ? pick(characters, rand) : undefined
  return own ? imageSprite(own) : emojiSprite(pick(Object.keys(LETTERS), rand) ?? 'a')
}

/** What to say after a letter: "B is for bear". */
export function letterPhrase(letter: string, sprite: Sprite): string {
  const L = letter.toUpperCase()
  // Nothing common starts with X, so the fox has one inside.
  if (letter === 'x' && sprite.kind === 'emoji') return `${L} is in ${sprite.name}`
  return `${L} is for ${sprite.name}`
}

export function numberWord(digit: number): string {
  return NUMBER_WORDS[digit] ?? String(digit)
}

/**
 * Remembers the last letters typed, to spot the exit word. Other keys don't
 * reset it, so a stray Shift doesn't make a grown-up start over.
 */
export class WordWatcher {
  private typed = ''

  constructor(private readonly word: string) {}

  /** Feed one lowercase letter; true when it completes the word. */
  push(letter: string): boolean {
    this.typed = (this.typed + letter).slice(-this.word.length)
    return this.typed === this.word
  }
}

// ---- music ----

/** Nursery rhymes as MIDI note numbers (C4 = 60). All in the public domain. */
export const SONGS: { name: string; notes: number[] }[] = [
  {
    name: 'Twinkle, Twinkle, Little Star',
    notes: [
      60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60, 67, 67, 65, 65, 64, 64, 62, 67, 67,
      65, 65, 64, 64, 62, 60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60
    ]
  },
  {
    name: 'Mary Had a Little Lamb',
    notes: [
      64, 62, 60, 62, 64, 64, 64, 62, 62, 62, 64, 67, 67, 64, 62, 60, 62, 64, 64, 64, 64, 62, 62,
      64, 62, 60
    ]
  },
  {
    name: 'Old MacDonald',
    notes: [
      60, 60, 60, 55, 57, 57, 55, 64, 64, 62, 62, 60, 55, 60, 60, 60, 55, 57, 57, 55, 64, 64, 62,
      62, 60, 55, 55, 60, 60, 60, 55, 55, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60,
      60, 60, 60, 60, 55, 57, 57, 55, 64, 64, 62, 62, 60
    ]
  },
  {
    name: 'Row, Row, Row Your Boat',
    notes: [
      60, 60, 60, 62, 64, 64, 62, 64, 65, 67, 72, 72, 72, 67, 67, 67, 64, 64, 64, 60, 60, 60, 67,
      65, 64, 62, 60
    ]
  },
  {
    name: 'Itsy Bitsy Spider',
    notes: [
      55, 60, 60, 60, 62, 64, 64, 64, 62, 60, 62, 64, 60, 64, 64, 65, 67, 67, 65, 64, 65, 67, 64,
      60, 60, 62, 64, 64, 62, 60, 62, 64, 60, 55, 55, 60, 60, 60, 62, 64, 64, 64, 62, 60, 62, 64, 60
    ]
  }
]

/** Plays the songs one note per key press, moving to the next song at the end of one. */
export class SongPlayer {
  private song = 0
  private note = 0

  next(): number {
    const song = SONGS[this.song] ?? SONGS[0]
    const midi = song?.notes[this.note] ?? 60
    this.note++
    if (!song || this.note >= song.notes.length) {
      this.note = 0
      this.song = (this.song + 1) % SONGS.length
    }
    return midi
  }
}

/** Steps of the major pentatonic scale, in semitones. Any mix of these notes sounds fine together. */
const PENTATONIC = [0, 2, 4, 7, 9]

/** A step on the C pentatonic scale, counted up from C4. */
export function pentatonic(step: number): number {
  const octave = Math.floor(step / PENTATONIC.length)
  const degree = ((step % PENTATONIC.length) + PENTATONIC.length) % PENTATONIC.length
  return 60 + 12 * octave + (PENTATONIC[degree] ?? 0)
}

/**
 * Notes rise from left to right along a row, like a xylophone, and each row
 * starts one step higher than the row below it.
 */
const ROWS: [number, string[]][] = [
  [0, ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash']],
  [
    1,
    ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote']
  ],
  [
    2,
    [
      'KeyQ',
      'KeyW',
      'KeyE',
      'KeyR',
      'KeyT',
      'KeyY',
      'KeyU',
      'KeyI',
      'KeyO',
      'KeyP',
      'BracketLeft',
      'BracketRight'
    ]
  ],
  [
    3,
    [
      'Backquote',
      'Digit1',
      'Digit2',
      'Digit3',
      'Digit4',
      'Digit5',
      'Digit6',
      'Digit7',
      'Digit8',
      'Digit9',
      'Digit0',
      'Minus',
      'Equal'
    ]
  ]
]

const KEY_STEPS = new Map(ROWS.flatMap(([start, codes]) => codes.map((c, i) => [c, start + i])))

export function noteForCode(code: string): number | null {
  const step = KEY_STEPS.get(code)
  return step === undefined ? null : pentatonic(step)
}

/** A letter from a key's physical position, for when Option or a layout changes e.key. */
export function letterForCode(code: string): string | null {
  const m = /^Key([A-Z])$/.exec(code)
  return m?.[1] ? m[1].toLowerCase() : null
}
