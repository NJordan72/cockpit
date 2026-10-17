// The pretend agent in kids mode's terminal: a welcome box, a prompt that
// echoes what's typed in color, and a turn with a spinner and an answer when
// Enter is pressed. It only writes to the terminal; nothing runs.
import type { Terminal } from '@xterm/xterm'

const ORANGE = '\x1b[38;2;215;119;87m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'
/** Bright red, green, yellow, blue, magenta, cyan. */
const COLORS = [91, 92, 93, 94, 95, 96].map((c) => `\x1b[1;${String(c)}m`)
const SPINNER = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢']
const VERBS = [
  'Giggling',
  'Wiggling',
  'Bouncing',
  'Sparkling',
  'Splashing',
  'Twirling',
  'Munching',
  'Painting',
  'Dancing',
  'Zooming',
  'Tickling',
  'Snuggling'
]
const ANSWERS = ['All done!', 'Ta-da!', 'It worked!', 'Hooray!', 'Shipped it!', 'Tests pass!']

const pick = <T>(items: readonly T[]): T =>
  items[Math.floor(Math.random() * items.length)] ?? (items[0] as T)

/** What the answer shows for each thing typed: an emoji, or a picture's name. */
export type Shown = { emoji: string } | { name: string }

export class PretendAgent {
  private line = 0
  private busy = false
  private timers: number[] = []

  constructor(
    private readonly term: Terminal,
    private readonly onStatus: (status: 'idle' | 'working' | 'done') => void
  ) {}

  welcome(name: string): void {
    const title = name ? `Welcome, ${name}!` : 'Welcome, little coder!'
    const body = 'Press the keys to make things happen.'
    const width = Math.max(title.length + 4, body.length + 4)
    const pad = (s: string, n: number): string => s + ' '.repeat(Math.max(0, n - s.length))
    const t = this.term
    t.write(`${ORANGE}╭${'─'.repeat(width)}╮${RESET}\r\n`)
    t.write(
      `${ORANGE}│${RESET} ${ORANGE}✻${RESET} ${BOLD}${pad(title, width - 3)}${RESET}${ORANGE}│${RESET}\r\n`
    )
    t.write(`${ORANGE}│${RESET}${' '.repeat(width)}${ORANGE}│${RESET}\r\n`)
    t.write(`${ORANGE}│${RESET}   ${DIM}${pad(body, width - 3)}${RESET}${ORANGE}│${RESET}\r\n`)
    t.write(`${ORANGE}╰${'─'.repeat(width)}╯${RESET}\r\n`)
    this.prompt()
  }

  private prompt(): void {
    this.line = 0
    this.term.write(`\r\n${DIM}>${RESET} `)
  }

  /** True when the line is full, so the caller can submit it. */
  type(ch: string): boolean {
    if (this.busy) return false
    this.term.write(`${pick(COLORS)}${ch}${RESET}`)
    this.line++
    return this.line >= this.term.cols - 4
  }

  backspace(): void {
    if (this.busy || this.line === 0) return
    this.term.write('\b \b')
    this.line--
  }

  /** Spins for 1.2 to 1.8 s, then answers with what was typed. Does nothing while already spinning. */
  submit(shown: Shown[], onAnswer: () => void): void {
    if (this.busy) return
    this.busy = true
    this.onStatus('working')
    const verb = pick(VERBS)
    const t = this.term
    t.write('\r\n')
    let frame = 0
    const spin = window.setInterval(() => {
      const f = SPINNER[frame++ % SPINNER.length] ?? '✻'
      t.write(`\r\x1b[2K${ORANGE}${f} ${verb}…${RESET}`)
    }, 110)
    this.timers.push(spin)
    this.timers.push(
      window.setTimeout(
        () => {
          window.clearInterval(spin)
          const max = Math.max(1, Math.floor((t.cols - 4) / 3))
          const items = shown
            .slice(0, max)
            .map((s) => ('emoji' in s ? s.emoji : `${BOLD}${pick(COLORS)}${s.name}${RESET}`))
          const what = items.length ? items.join(' ') : '✨'
          t.write(`\r\x1b[2K${BOLD}⏺${RESET} ${what}\r\n`)
          t.write(`  ${DIM}⎿${RESET}  ${pick(ANSWERS)}\r\n`)
          this.busy = false
          this.onStatus('done')
          this.timers.push(window.setTimeout(() => this.onStatus('idle'), 2500))
          onAnswer()
          this.prompt()
        },
        1200 + Math.random() * 600
      )
    )
  }

  get thinking(): boolean {
    return this.busy
  }

  dispose(): void {
    for (const id of this.timers) {
      window.clearTimeout(id)
      window.clearInterval(id)
    }
    this.timers = []
  }
}
