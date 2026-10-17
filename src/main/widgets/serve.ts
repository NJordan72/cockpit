// Pure pieces of the cockpit-widget:// protocol handler.
import path from 'node:path'
import { themeCss } from '@shared/theme'
import { SDK_PATH, WIDGET_SCHEME } from '@shared/widgets'

/**
 * The policy every widget response carries. Scripts, styles, and images may
 * come from the widget's own folder (or be inline); nothing may connect out.
 * Network access goes through cockpit.fetch.
 */
export function widgetCsp(widgetId: string): string {
  const self = `${WIDGET_SCHEME}://${widgetId}`
  return [
    "default-src 'none'",
    `script-src ${self} 'unsafe-inline'`,
    `style-src ${self} 'unsafe-inline'`,
    `img-src ${self} data: blob:`,
    `font-src ${self} data:`,
    `media-src ${self} data: blob:`,
    `worker-src ${self} blob:`,
    "connect-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'"
  ].join('; ')
}

export function widgetHeaders(widgetId: string): Record<string, string> {
  return {
    'content-security-policy': widgetCsp(widgetId),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-dns-prefetch-control': 'off',
    'referrer-policy': 'no-referrer',
    // Widgets have an opaque origin, so module scripts from their own folder
    // are cross-origin loads. Only the widget itself can load these files
    // (the chrome's CSP can't reach this scheme), and only its own.
    'access-control-allow-origin': '*'
  }
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm'
}

export function contentType(file: string): string {
  return TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Map a URL path to a file inside the widget folder, or null if it would
 * escape the folder. `pathname` is the URL's (percent-encoded) path.
 */
export function resolveWidgetFile(root: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null
  const full = path.join(root, decoded)
  return full.startsWith(root + path.sep) && !full.endsWith(path.sep) ? full : null
}

/**
 * Page defaults that match the chrome. :where() has no specificity, so any
 * rule in the widget's own CSS wins.
 */
const BASE_CSS =
  ':where(html) { color-scheme: var(--color-scheme); background: var(--bg); color: var(--fg); font-family: var(--font-ui); }'

/** The theme and the SDK go first, ahead of any widget script. */
export function injection(themeVars: Record<string, string>): string {
  return (
    `<style id="cockpit-theme">${themeCss(themeVars)} ${BASE_CSS}</style>` +
    `<script src="${SDK_PATH}"></script>`
  )
}

/**
 * Insert `snippet` at the very start of the document, but after a doctype so
 * the page stays in standards mode. The parser moves it into <head>.
 */
export function injectIntoHtml(html: string, snippet: string): string {
  const doctype = /^\uFEFF?\s*<!doctype[^>]*>/i.exec(html)
  if (!doctype) return snippet + html
  const at = doctype[0].length
  return html.slice(0, at) + snippet + html.slice(at)
}
