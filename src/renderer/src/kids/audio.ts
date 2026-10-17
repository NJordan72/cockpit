// Kids mode's sounds, made with Web Audio: a soft bell for notes, plus a few
// little tunes. Nothing is loaded from disk.

const freq = (midi: number): number => 440 * 2 ** ((midi - 69) / 12)

/** Harmonics of the bell: [multiple of the note, loudness, wave]. */
const PARTIALS: [number, number, OscillatorType][] = [
  [1, 1, 'triangle'],
  [2, 0.25, 'sine'],
  [3, 0.08, 'sine']
]

/** More notes than this at once and new ones are dropped; a palm on the keys stays pleasant. */
const MAX_VOICES = 24

export class KidsAudio {
  private ctx: AudioContext | null = null
  private out: GainNode | null = null
  private voices = 0

  constructor(private readonly volume: number) {}

  /** Created on first use, which is always a key press or click, so autoplay rules allow it. */
  private output(): { ctx: AudioContext; out: GainNode } | null {
    if (this.volume <= 0) return null
    if (!this.ctx || !this.out) {
      const ctx = new AudioContext()
      // The compressor keeps many notes at once from clipping.
      const comp = ctx.createDynamicsCompressor()
      const out = ctx.createGain()
      out.gain.value = this.volume * 0.5
      out.connect(comp).connect(ctx.destination)
      this.ctx = ctx
      this.out = out
    }
    return { ctx: this.ctx, out: this.out }
  }

  /** One bell note, `delay` seconds from now. */
  note(midi: number, delay = 0, length = 1.1, loudness = 0.5): void {
    const o = this.output()
    if (!o || this.voices >= MAX_VOICES) return
    const { ctx, out } = o
    const t = ctx.currentTime + delay
    const env = ctx.createGain()
    env.gain.setValueAtTime(0.0001, t)
    env.gain.exponentialRampToValueAtTime(loudness, t + 0.008)
    env.gain.exponentialRampToValueAtTime(0.0001, t + length)
    env.connect(out)
    this.voices++
    let left = PARTIALS.length
    for (const [mult, gain, type] of PARTIALS) {
      const osc = ctx.createOscillator()
      osc.type = type
      osc.frequency.value = freq(midi) * mult
      const g = ctx.createGain()
      g.gain.value = gain
      osc.connect(g).connect(env)
      osc.onended = () => {
        osc.disconnect()
        g.disconnect()
        if (--left === 0) {
          env.disconnect()
          this.voices--
        }
      }
      osc.start(t)
      osc.stop(t + length + 0.05)
    }
  }

  /** Notes one after another. */
  run(midis: number[], step: number, loudness = 0.4): void {
    midis.forEach((m, i) => {
      this.note(m, i * step, 0.9, loudness)
    })
  }

  /** Enter: a little fanfare. */
  fanfare(): void {
    this.run([72, 76, 79, 84], 0.09)
  }

  /** The pretend agent finished. */
  ding(): void {
    this.run([84, 91], 0.12, 0.3)
  }

  /** Backspace: down two notes. */
  boop(): void {
    this.run([67, 60], 0.08, 0.35)
  }

  close(): void {
    void this.ctx?.close()
    this.ctx = null
    this.out = null
  }
}
