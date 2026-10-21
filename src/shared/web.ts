// Web panes: what may be opened in one, and turning what the user typed into a URL.

/** Schemes a web pane may show. Everything else (cockpit-*, javascript:, data:) is refused. */
const WEB_PROTOCOLS = new Set(['http:', 'https:', 'file:'])

/** The partition web panes browse in: its own cookies and cache, and the normal network. */
export const WEB_PARTITION = 'persist:web'

export function isWebUrl(url: string): boolean {
  try {
    return WEB_PROTOCOLS.has(new URL(url).protocol)
  } catch {
    return false
  }
}

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?([/?#]|$)/i
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i
// A dot or a port somewhere in the host part, and no spaces.
const HOST_LIKE = /^[^\s/?#]+(\.[^\s/?#]+|:\d+)([/?#]\S*)?$/

/**
 * A URL for what was typed in the address field: a full URL, an absolute
 * path (a file), localhost with an optional port (http), or a bare host
 * (https). Null when it is none of those.
 */
export function toWebUrl(input: string): string | null {
  const text = input.trim()
  if (!text) return null
  let url: string
  if (text.startsWith('/')) url = `file://${encodeURI(text)}`
  else if (SCHEME.test(text)) url = text
  else if (LOCAL_HOST.test(text)) url = `http://${text}`
  else if (HOST_LIKE.test(text)) url = `https://${text}`
  else return null
  if (!isWebUrl(url)) return null
  return new URL(url).href
}

/** What open-in-browser may hand to the OS: a web page, never an app or a script. */
export function canOpenExternally(url: string): boolean {
  if (!isWebUrl(url)) return false
  const u = new URL(url)
  return u.protocol !== 'file:' || /\.(html?|pdf|svg)$/i.test(u.pathname)
}

/** A short name for a page with no title yet. */
export function pageLabel(url: string): string {
  try {
    const u = new URL(url)
    if (u.protocol === 'file:') return decodeURI(u.pathname).split('/').filter(Boolean).pop() ?? url
    return u.host || url
  } catch {
    return url
  }
}
