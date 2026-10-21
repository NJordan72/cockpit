import { useEffect, useRef } from 'react'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { terminalFontStack, type KidsSettings, type TerminalSettings } from '@shared/config'
import type { KidsCharacter } from '@shared/ipc'
import type { Theme } from '@shared/theme'
import { slotName } from '../frame/layout'
import { KidsAudio } from './audio'
import { Effects } from './effects'
import {
  letterForCode,
  letterPhrase,
  noteForCode,
  numberWord,
  pentatonic,
  randomSprite,
  SongPlayer,
  spriteForLetter,
  WordWatcher,
  type Sprite
} from './model'
import { PretendAgent, type Shown } from './pretend'

export type KidsStatus = 'idle' | 'working' | 'done'

interface Props {
  settings: KidsSettings
  terminal: TerminalSettings
  theme: Theme
  xtermTheme: ITheme
  /** The pretend agent's state, for the tab bar's kids tab. */
  onStatus: (status: KidsStatus) => void
  onExit: () => void
}

/** Song notes closer together than this are skipped, so a palm on the keys still plays the tune. */
const SONG_GAP_MS = 110
/** Speak once typing pauses this long. */
const SPEAK_DELAY_MS = 450

const shownFor = (s: Sprite): Shown => (s.kind === 'emoji' ? { emoji: s.text } : { name: s.name })

/**
 * A pretend terminal for a small child, drawn over the workspace in place of
 * the real terminals. It takes every key: letters show big and bring out a
 * character, keys play music, and Enter makes the pretend agent "work". Typing
 * the exit word leaves.
 */
export function KidsMode({
  settings,
  terminal,
  theme,
  xtermTheme,
  onStatus,
  onExit
}: Props): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<HTMLDivElement>(null)
  const fxRef = useRef<HTMLDivElement>(null)
  // Read when the effect starts; kids mode restarts to pick up changes.
  const start = useRef({ settings, terminal, theme, xtermTheme, onStatus, onExit })

  useEffect(() => {
    const root = rootRef.current
    const host = termRef.current
    const layer = fxRef.current
    if (!root || !host || !layer) return
    const { settings, terminal, theme, xtermTheme, onStatus, onExit } = start.current

    const term = new Terminal({
      fontFamily: terminalFontStack(terminal.fontFamily),
      fontSize: Math.min(48, Math.round(terminal.fontSize * 2)),
      lineHeight: 1.1,
      cursorBlink: true,
      disableStdin: true,
      allowProposedApi: true,
      scrollback: 500,
      theme: xtermTheme
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11'
    term.open(host)
    fit.fit()

    const agent = new PretendAgent(term, onStatus)
    agent.welcome(settings.name)
    const audio = new KidsAudio(settings.volume)
    const fx = new Effects(layer, [
      theme.red,
      theme.green,
      theme.yellow,
      theme.blue,
      theme.magenta,
      theme.cyan
    ])
    const exit = new WordWatcher(settings.exitWord)
    const songs = new SongPlayer()
    let characters: KidsCharacter[] = []
    let lastSongNote = 0
    let line: Sprite[] = []
    let speakTimer = 0
    let done = false

    void window.cockpit.kids
      .characters()
      .then((list) => {
        characters = list
      })
      .catch((err: unknown) => {
        console.warn('kids mode could not read its pictures:', err)
      })

    /** Plays the song's next note, or in notes mode the note for where the key sits. */
    const tone = (code: string | null): void => {
      if (settings.sound === 'songs') {
        const now = performance.now()
        if (now - lastSongNote < SONG_GAP_MS) return
        lastSongNote = now
        audio.note(songs.next() + 12)
      } else {
        audio.note((code ? noteForCode(code) : null) ?? pentatonic(Math.floor(Math.random() * 12)))
      }
    }

    const say = (text: string): void => {
      if (!settings.speak || !('speechSynthesis' in window)) return
      window.clearTimeout(speakTimer)
      speakTimer = window.setTimeout(() => {
        speechSynthesis.cancel()
        const u = new SpeechSynthesisUtterance(text)
        u.rate = 0.85
        u.pitch = 1.2
        u.volume = settings.volume
        speechSynthesis.speak(u)
      }, SPEAK_DELAY_MS)
    }

    const submit = (): void => {
      if (agent.thinking) return
      const typed = line
      line = []
      audio.fanfare()
      agent.submit(typed.map(shownFor), () => {
        audio.ding()
        const marchers = typed.length
          ? typed.slice(-8)
          : Array.from({ length: 3 }, () => randomSprite(characters, Math.random))
        fx.parade(marchers)
      })
    }

    const echo = (ch: string, sprite: Sprite | null): void => {
      if (agent.thinking) return
      if (sprite) line.push(sprite)
      if (agent.type(ch)) submit()
    }

    const onKey = (key: string, code: string): void => {
      const letter = /^[a-z]$/i.test(key) ? key.toLowerCase() : letterForCode(code)
      if (letter) {
        if (exit.push(letter)) {
          done = true
          onExit()
          return
        }
        const sprite = spriteForLetter(letter, characters, Math.random)
        fx.bigLetter(letter.toUpperCase())
        fx.sprite(sprite)
        tone(code)
        echo(key.length === 1 ? key : letter, sprite)
        say(letterPhrase(letter, sprite))
        return
      }
      const digit = /^Digit(\d)$/.exec(code)?.[1]
      if (digit !== undefined) {
        const n = Number(digit)
        fx.bigLetter(digit)
        // 3 shows three of one character to count, and 0 shows ten.
        fx.row(randomSprite(characters, Math.random), n === 0 ? 10 : n)
        tone(code)
        echo(digit, null)
        say(numberWord(n))
        return
      }
      switch (key) {
        case 'Enter':
          submit()
          return
        case 'Backspace':
        case 'Delete':
          audio.boop()
          if (line.length) line.pop()
          agent.backspace()
          return
        case ' ':
          fx.sprite(randomSprite(characters, Math.random), { move: 'walk' })
          tone(code)
          echo(' ', null)
          return
      }
      if (key.length === 1) {
        fx.bigLetter(key)
        fx.sparkle()
        tone(code)
        echo(key, null)
        return
      }
      // Arrows, Escape, Tab, modifiers on their own, ...
      fx.sparkle()
      tone(null)
    }

    // Capture phase on the window, so nothing else (a real terminal, a panel)
    // ever sees the key. The chrome's own shortcut handler stands aside while
    // kids mode is on.
    const onKeyDown = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.repeat || done) return
      onKey(e.key, e.code)
    }
    const swallow = (e: Event): void => {
      e.preventDefault()
      e.stopPropagation()
    }
    const onPointer = (e: PointerEvent): void => {
      e.preventDefault()
      root.focus()
      const box = root.getBoundingClientRect()
      const x = e.clientX - box.left
      const y = e.clientY - box.top
      fx.sprite(randomSprite(characters, Math.random), {
        move: Math.random() < 0.5 ? 'jump' : 'spin',
        spot: { x: (x / box.width) * 100, y: (y / box.height) * 100 }
      })
      fx.sparkle({ x, y })
      if (settings.sound === 'songs') tone(null)
      else audio.note(pentatonic(Math.floor((x / box.width) * 15)))
    }
    const keepFocus = (): void => {
      requestAnimationFrame(() => root.focus())
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', swallow, true)
    window.addEventListener('keypress', swallow, true)
    window.addEventListener('paste', swallow, true)
    window.addEventListener('focus', keepFocus)
    root.addEventListener('pointerdown', onPointer)
    root.focus()

    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (host.clientWidth > 0 && host.clientHeight > 0) fit.fit()
      })
    })
    observer.observe(host)

    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', swallow, true)
      window.removeEventListener('keypress', swallow, true)
      window.removeEventListener('paste', swallow, true)
      window.removeEventListener('focus', keepFocus)
      root.removeEventListener('pointerdown', onPointer)
      observer.disconnect()
      cancelAnimationFrame(frame)
      window.clearTimeout(speakTimer)
      if ('speechSynthesis' in window) speechSynthesis.cancel()
      agent.dispose()
      onStatus('idle')
      fx.clear()
      audio.close()
      term.dispose()
    }
  }, [])

  return (
    <div
      className="kids"
      ref={rootRef}
      tabIndex={-1}
      style={{ ['--anchor' as string]: slotName('workspace') }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="kids-terminal" ref={termRef} />
      <div className="kids-fx" ref={fxRef} />
    </div>
  )
}
