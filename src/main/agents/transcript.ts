// Reads a Claude Code session's title and context size from its transcript
// (~/.claude/projects/<project>/<session>.jsonl), whose path every hook
// payload carries. Transcripts reach many megabytes, so only the tail is read.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const TAIL_BYTES = 1024 * 1024

export interface TranscriptInfo {
  title: string | null
  /** Tokens the last main-thread request sent and received. */
  tokens: number | null
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** The newest title and token count in JSONL text. Unknown or broken lines are skipped. */
export function parseTranscriptTail(text: string): TranscriptInfo {
  let title: string | null = null
  let tokens: number | null = null
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0 && (title === null || tokens === null); i--) {
    const line = lines[i]
    if (!line?.startsWith('{')) continue
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (!isObj(entry)) continue
    if (title === null && entry.type === 'ai-title' && typeof entry.aiTitle === 'string') {
      title = entry.aiTitle.trim() || null
    } else if (
      tokens === null &&
      entry.type === 'assistant' &&
      entry.isSidechain !== true &&
      isObj(entry.message) &&
      isObj(entry.message.usage)
    ) {
      const u = entry.message.usage
      tokens =
        num(u.input_tokens) +
        num(u.cache_creation_input_tokens) +
        num(u.cache_read_input_tokens) +
        num(u.output_tokens)
    }
  }
  return { title, tokens }
}

/** Only files under ~/.claude are read; the path comes from a hook payload. */
export async function readTranscript(
  file: string,
  root = path.join(os.homedir(), '.claude')
): Promise<TranscriptInfo | null> {
  if (!path.isAbsolute(file) || !file.endsWith('.jsonl')) return null
  let handle: fs.FileHandle | null = null
  try {
    const real = await fs.realpath(file)
    const realRoot = await fs.realpath(root)
    if (!real.startsWith(realRoot + path.sep)) return null
    handle = await fs.open(real, 'r')
    const { size } = await handle.stat()
    const start = Math.max(0, size - TAIL_BYTES)
    const buf = Buffer.alloc(size - start)
    await handle.read(buf, 0, buf.length, start)
    let text = buf.toString('utf8')
    // The first line of a tail is usually cut off.
    if (start > 0) text = text.slice(text.indexOf('\n') + 1)
    return parseTranscriptTail(text)
  } catch {
    return null
  } finally {
    await handle?.close()
  }
}
