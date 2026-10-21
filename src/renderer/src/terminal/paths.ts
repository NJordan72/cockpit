// Finds text in a terminal line that might be a file path. Main decides which
// candidates are real files; this only has to avoid missing them.

export interface PathCandidate {
  /** The path as written, without a trailing :line:col. */
  path: string
  /** Offset of the first character in the line. */
  start: number
  /** Offset just past the last character that should be underlined. */
  end: number
}

// Runs of characters that can appear in a path. Quotes, brackets, and
// backticks end one, since agents wrap paths in them.
const TOKEN = /[^\s'"`<>()[\]{}|,;]+/g
// A bare name needs an extension to be worth checking: "index.html", not "the".
const BARE_FILE = /^[\w@+-][\w.@+-]*\.[A-Za-z0-9]{1,10}$/

export function findPathCandidates(line: string): PathCandidate[] {
  const out: PathCandidate[] = []
  for (const m of line.matchAll(TOKEN)) {
    let text = m[0]
    let start = m.index
    if (text.includes('://')) continue // URLs belong to the web links addon
    // Sentence punctuation and :line:col suffixes aren't part of the path.
    text = text.replace(/[.:!?]+$/, '')
    text = text.replace(/(:\d+){1,2}$/, '')
    // A leading "a/" or "b/" from a diff header stays; a leading ":" doesn't.
    const lead = /^[:=]+/.exec(text)
    if (lead) {
      text = text.slice(lead[0].length)
      start += lead[0].length
    }
    if (text.length < 2 || text.length > 1024) continue
    if (!text.includes('/') && !BARE_FILE.test(text)) continue
    if (/^\d[\d/.]*$/.test(text)) continue // dates, fractions, versions
    out.push({ path: text, start, end: start + text.length })
  }
  return out
}
