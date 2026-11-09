// Reading OSC sequences out of a PTY's output, and the Program Status reports
// (OSC 7501) that agents send through them. Pure, so it can be tested.
//
// Program Status spec: https://www.superlogical.com/rex/docs/build/program-status

export interface Osc {
  code: number
  text: string
}

/** Longer than any title, notification, or status report an agent sends; past it, a sequence is dropped. */
const MAX_OSC = 8192

/** Finds OSC sequences in terminal output, including ones split across chunks. */
export class OscScanner {
  private partial = ''

  feed(chunk: string): Osc[] {
    // Most output has no escape sequences at all.
    if (!this.partial && !chunk.includes('\x1b')) return []
    const data = this.partial + chunk
    this.partial = ''
    const found: Osc[] = []
    let i = 0
    for (;;) {
      const start = data.indexOf('\x1b]', i)
      if (start === -1) {
        if (data.endsWith('\x1b')) this.partial = '\x1b'
        return found
      }
      // Terminated by BEL or by ST (ESC \). Any other ESC aborts the sequence.
      let end = -1
      let next = -1
      for (let j = start + 2; j < data.length; j++) {
        const c = data.charCodeAt(j)
        if (c === 0x07) {
          end = j
          next = j + 1
          break
        }
        if (c === 0x1b) {
          if (j + 1 === data.length) break
          end = data[j + 1] === '\\' ? j : -2
          next = data[j + 1] === '\\' ? j + 2 : j
          break
        }
      }
      if (next === -1) {
        const rest = data.slice(start)
        if (rest.length <= MAX_OSC) this.partial = rest
        return found
      }
      if (end >= 0) {
        const body = data.slice(start + 2, end)
        const semi = body.indexOf(';')
        const code = Number(semi === -1 ? body : body.slice(0, semi))
        if (Number.isInteger(code))
          found.push({ code, text: semi === -1 ? '' : body.slice(semi + 1) })
      }
      i = next
    }
  }
}

/** The Program Status protocol's OSC number. */
export const PROGRAM_STATUS_OSC = 7501

export type ProgramState = 'idle' | 'working' | 'done' | 'blocked' | 'error' | 'clear'
export type BlockedKind = 'permission' | 'question' | 'auth'

/** One OSC 7501 report. A report replaces its record whole, so a missing key means none. */
export interface ProgramStatus {
  state: ProgramState
  /** The record it's about, "/"-separated; null for the program's root record. */
  id: string | null
  /** Why a blocked program is waiting. */
  kind: BlockedKind | null
  /** Percent done, 0 to 100; null when not known. */
  progress: number | null
  app: string | null
  title: string | null
  msg: string | null
}

const STATES = new Set<string>(['idle', 'working', 'done', 'blocked', 'error', 'clear'])
const KINDS = new Set<string>(['permission', 'question', 'auth'])
const KEY = /^[a-z]{1,16}$/
const VALUE = /^[A-Za-z0-9_.,+/=-]*$/
const SEGMENT = /^[A-Za-z0-9_.+-]{1,32}$/
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/
const MAX_REPORT = 4096
const utf8 = new TextDecoder('utf-8', { fatal: true })

/** Standard base64 of UTF-8, with or without padding. undefined when it isn't valid. */
function decodeText(value: string, maxEncoded: number, maxDecoded: number): string | undefined {
  if (value.length > maxEncoded || !BASE64.test(value)) return undefined
  const bare = value.replace(/=+$/, '')
  if (bare.length % 4 === 1 || (value.length > bare.length && value.length % 4 !== 0)) {
    return undefined
  }
  const bytes = Buffer.from(bare, 'base64')
  if (bytes.length > maxDecoded) return undefined
  let text: string
  try {
    text = utf8.decode(bytes)
  } catch {
    return undefined
  }
  return CONTROL.test(text) ? undefined : text
}

function validId(id: string): boolean {
  if (id.length > 128) return false
  const segments = id.split('/')
  return segments.length <= 8 && segments.every((s) => SEGMENT.test(s))
}

/**
 * An OSC 7501 report's text (everything after "7501;"), read the way the
 * spec says a terminal must: malformed pairs and unknown keys are skipped,
 * and a report with no known state, a bad id, bad base64, or control
 * characters in its text is dropped whole. The feature query ("?") isn't a
 * report either.
 */
export function parseProgramStatus(text: string): ProgramStatus | null {
  if (text.length > MAX_REPORT || text.trimStart().startsWith('?')) return null
  const pairs = new Map<string, string>()
  for (const pair of text.split(':')) {
    const eq = pair.indexOf('=')
    if (eq === -1) continue
    const key = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    if (KEY.test(key) && VALUE.test(value)) pairs.set(key, value)
  }
  const state = pairs.get('state')
  if (!state || !STATES.has(state)) return null
  // An empty id names no record, so it's as bad as a malformed one.
  const id = pairs.get('id') ?? null
  if (id !== null && !validId(id)) return null
  const fields = { title: [256, 192], msg: [2732, 2048] } as const
  const decoded: Record<keyof typeof fields, string | null> = { title: null, msg: null }
  for (const key of ['title', 'msg'] as const) {
    const value = pairs.get(key)
    if (value === undefined) continue
    const [maxEncoded, maxDecoded] = fields[key]
    const text = decodeText(value, maxEncoded, maxDecoded)
    if (text === undefined) return null
    decoded[key] = text.trim() || null
  }
  const kind = pairs.get('kind')
  const progress = /^\d{1,3}$/.test(pairs.get('progress') ?? '')
    ? Number(pairs.get('progress'))
    : -1
  const app = pairs.get('app')
  return {
    state: state as ProgramState,
    id,
    kind: kind && KINDS.has(kind) ? (kind as BlockedKind) : null,
    progress: progress >= 0 && progress <= 100 ? progress : null,
    app: app && SEGMENT.test(app) ? app : null,
    ...decoded
  }
}
