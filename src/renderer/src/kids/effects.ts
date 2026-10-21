// Kids mode's animations: big letters, characters doing things, and sparkles,
// drawn as elements on a layer above the pretend terminal and removed when
// their animation ends.
import type { Rand, Sprite } from './model'

export type Move = 'walk' | 'jump' | 'spin' | 'dance' | 'float' | 'zoom'

const MOVES: Move[] = ['walk', 'jump', 'spin', 'dance', 'float', 'zoom']

/** How many of each can be on screen; the oldest goes first. */
const LIMITS = { 'kids-letter': 6, 'kids-sprite': 16, 'kids-sparkle': 64 }

type Kind = keyof typeof LIMITS

interface Spot {
  /** Percent of the layer's width and height. */
  x: number
  y: number
}

// cqw and cqh are percent of the layer, which is a size container.
const at = (s: Spot, extra = ''): string =>
  `translate(${s.x.toFixed(1)}cqw, ${s.y.toFixed(1)}cqh) translate(-50%, -50%) ${extra}`

function keyframesFor(move: Move, s: Spot, rand: Rand): Keyframe[] {
  switch (move) {
    case 'walk': {
      // Across the screen, bobbing, from whichever side.
      const ltr = rand() < 0.5
      const from = ltr ? -20 : 120
      const to = ltr ? 120 : -20
      return Array.from({ length: 11 }, (_, i) => {
        const p = i / 10
        const bob = i % 2 === 0 ? 0 : -4
        return {
          transform: at({ x: from + (to - from) * p, y: s.y + bob }, `rotate(${bob ? -6 : 6}deg)`)
        }
      })
    }
    case 'jump':
      return [
        { transform: at(s, 'scale(0)'), offset: 0 },
        { transform: at(s, 'scale(1)'), offset: 0.12 },
        { transform: at({ ...s, y: s.y - 25 }, 'scale(1, 1.1)'), offset: 0.35, easing: 'ease-in' },
        { transform: at(s, 'scale(1.15, 0.85)'), offset: 0.55, easing: 'ease-out' },
        { transform: at({ ...s, y: s.y - 15 }, 'scale(1)'), offset: 0.72, easing: 'ease-in' },
        { transform: at(s, 'scale(1)'), offset: 0.88 },
        { transform: at(s, 'scale(0)'), offset: 1 }
      ]
    case 'spin':
      return [
        { transform: at(s, 'scale(0.2) rotate(0deg)'), opacity: 0 },
        { transform: at(s, 'scale(1.2) rotate(360deg)'), opacity: 1, offset: 0.5 },
        { transform: at(s, 'scale(1) rotate(720deg)'), opacity: 1, offset: 0.8 },
        { transform: at(s, 'scale(0.6) rotate(760deg)'), opacity: 0 }
      ]
    case 'dance':
      return [
        { transform: at(s, 'scale(0)') },
        ...Array.from({ length: 8 }, (_, i) => ({
          transform: at(s, `rotate(${i % 2 ? 18 : -18}deg) scale(${i % 2 ? 1.1 : 1})`)
        })),
        { transform: at(s, 'scale(0)') }
      ]
    case 'float':
      // Up from the bottom like a balloon, swaying.
      return Array.from({ length: 9 }, (_, i) => ({
        transform: at({ x: s.x + (i % 2 ? 6 : -6), y: 115 - (150 * i) / 8 }, 'rotate(0deg)')
      }))
    case 'zoom':
      return [
        { transform: at(s, 'scale(0.1)'), opacity: 0 },
        { transform: at(s, 'scale(1)'), opacity: 1, offset: 0.3 },
        { transform: at(s, 'scale(2.4)'), opacity: 0 }
      ]
  }
}

const DURATIONS: Record<Move, number> = {
  walk: 3600,
  jump: 1900,
  spin: 1700,
  dance: 2200,
  float: 4200,
  zoom: 1500
}

export class Effects {
  constructor(
    private readonly layer: HTMLElement,
    private readonly colors: string[],
    private readonly rand: Rand = Math.random
  ) {}

  private add(kind: Kind, el: HTMLElement): void {
    const existing = this.layer.getElementsByClassName(kind)
    while (existing.length >= LIMITS[kind]) existing[0]?.remove()
    el.classList.add(kind)
    this.layer.appendChild(el)
  }

  private play(el: HTMLElement, frames: Keyframe[], opts: KeyframeAnimationOptions): void {
    const anim = el.animate(frames, { fill: 'both', ...opts })
    anim.onfinish = () => el.remove()
    anim.oncancel = () => el.remove()
  }

  private color(): string {
    return this.colors[Math.floor(this.rand() * this.colors.length)] ?? '#fff'
  }

  private spot(): Spot {
    return { x: 15 + this.rand() * 70, y: 22 + this.rand() * 56 }
  }

  /** A big letter near the middle that pops in and drifts up. */
  bigLetter(text: string): void {
    const el = document.createElement('div')
    el.textContent = text
    el.style.color = this.color()
    const s = { x: 50 + (this.rand() - 0.5) * 30, y: 50 + (this.rand() - 0.5) * 24 }
    this.add('kids-letter', el)
    this.play(
      el,
      [
        { transform: at(s, 'scale(0.2) rotate(-8deg)'), opacity: 0 },
        { transform: at(s, 'scale(1.15) rotate(3deg)'), opacity: 1, offset: 0.18 },
        { transform: at(s, 'scale(1)'), opacity: 1, offset: 0.3 },
        { transform: at({ ...s, y: s.y - 6 }, 'scale(1)'), opacity: 1, offset: 0.75 },
        { transform: at({ ...s, y: s.y - 18 }, 'scale(0.9)'), opacity: 0 }
      ],
      { duration: 1600, easing: 'ease-out' }
    )
  }

  /** A character doing something: a given move at a spot, or a random one. */
  sprite(
    sprite: Sprite,
    opts: { move?: Move; spot?: Spot; delay?: number; size?: number } = {}
  ): void {
    const el = spriteElement(sprite)
    if (opts.size) el.style.setProperty('--size', `${opts.size}cqh`)
    const move = opts.move ?? MOVES[Math.floor(this.rand() * MOVES.length)] ?? 'jump'
    this.add('kids-sprite', el)
    this.play(el, keyframesFor(move, opts.spot ?? this.spot(), this.rand), {
      duration: DURATIONS[move],
      delay: opts.delay ?? 0,
      easing: move === 'walk' || move === 'float' ? 'linear' : 'ease-in-out'
    })
  }

  /** `count` of the same character in a row, jumping one after another: something to count. */
  row(sprite: Sprite, count: number): void {
    const size = Math.min(22, 90 / count)
    const y = 30 + this.rand() * 40
    for (let i = 0; i < count; i++) {
      const x = 50 + (i - (count - 1) / 2) * size * 0.85
      this.sprite(sprite, { move: 'jump', spot: { x, y }, delay: i * 140, size })
    }
  }

  /** Characters walking across one after another. */
  parade(sprites: Sprite[]): void {
    const y = 35 + this.rand() * 30
    sprites.forEach((s, i) => {
      this.sprite(s, { move: 'walk', spot: { x: 0, y }, delay: i * 450 })
    })
  }

  /** Stars flying out from a point (in pixels from the layer's corner), or a random spot. */
  sparkle(px?: { x: number; y: number }): void {
    const box = this.layer.getBoundingClientRect()
    const s = px
      ? { x: (px.x / box.width) * 100, y: (px.y / box.height) * 100 }
      : { x: 10 + this.rand() * 80, y: 15 + this.rand() * 70 }
    for (let i = 0; i < 8; i++) {
      const el = document.createElement('div')
      el.textContent = this.rand() < 0.5 ? '✦' : '★'
      el.style.color = this.color()
      const angle = (i / 8) * Math.PI * 2 + this.rand() * 0.4
      const dist = 8 + this.rand() * 10
      const end = { x: s.x + Math.cos(angle) * dist, y: s.y + Math.sin(angle) * dist * 1.4 }
      this.add('kids-sparkle', el)
      this.play(
        el,
        [
          { transform: at(s, 'scale(0.4)'), opacity: 1 },
          { transform: at(end, 'scale(1.2) rotate(90deg)'), opacity: 0 }
        ],
        { duration: 700 + this.rand() * 300, easing: 'ease-out' }
      )
    }
  }

  clear(): void {
    for (const anim of this.layer.getAnimations({ subtree: true })) anim.cancel()
    this.layer.replaceChildren()
  }
}

function spriteElement(sprite: Sprite): HTMLElement {
  if (sprite.kind === 'emoji') {
    const el = document.createElement('div')
    el.textContent = sprite.text
    return el
  }
  const img = document.createElement('img')
  img.src = sprite.src
  img.alt = ''
  img.draggable = false
  return img
}
