// The cockpit-asset:// protocol: theme files and images for the chrome.
//   cockpit-asset://themes/<id>/<path>  ->  ~/.cockpit/themes/<id>/<path>
//   cockpit-asset://images/<path>       ->  ~/.cockpit/images/<path>
import fs from 'node:fs/promises'
import path from 'node:path'
import { protocol } from 'electron'
import { ASSET_SCHEME } from '@shared/assets'
import { resolveWidgetFile } from './widgets/serve'

/** Only what a stylesheet or an <img> needs. */
const TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.apng': 'image/apng',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf'
}

export interface AssetRoots {
  /** Real path of a user theme's folder. */
  theme: (id: string) => string | null
  /** Real path of ~/.cockpit/images. */
  images: () => string | null
}

/** The file a URL names and its type, or null if it isn't one we serve. */
export function assetFile(
  url: string,
  roots: AssetRoots
): { file: string; root: string; type: string } | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== `${ASSET_SCHEME}:`) return null
  let root: string | null = null
  let rest = u.pathname
  if (u.host === 'images') {
    root = roots.images()
  } else if (u.host === 'themes') {
    const m = /^\/([^/]+)(\/.*)$/.exec(u.pathname)
    if (!m?.[1] || !m[2]) return null
    let id: string
    try {
      id = decodeURIComponent(m[1])
    } catch {
      return null
    }
    root = roots.theme(id)
    rest = m[2]
  }
  if (!root) return null
  const file = resolveWidgetFile(root, rest)
  const type = file ? TYPES[path.extname(file).toLowerCase()] : undefined
  return file && type ? { file, root, type } : null
}

function notFound(): Response {
  return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } })
}

/** Call once the app is ready. The scheme is registered in schemes.ts. */
export function serveAssets(roots: AssetRoots): void {
  protocol.handle(ASSET_SCHEME, async (req) => {
    const found = assetFile(req.url, roots)
    if (!found) return notFound()
    try {
      // Links inside the folder may point anywhere; the real file must stay inside.
      const real = await fs.realpath(found.file)
      if (!real.startsWith(found.root + path.sep)) return notFound()
      const body = await fs.readFile(real)
      return new Response(body, {
        headers: {
          'content-type': found.type,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          // Fonts load in CORS mode, and the chrome's page is file://.
          'access-control-allow-origin': '*'
        }
      })
    } catch {
      return notFound()
    }
  })
}
