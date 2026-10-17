// cockpit-asset:// serves files the chrome shows but that live in the user's
// Cockpit folder: theme stylesheets, fonts, and images, and pictures for image
// panels. Widgets can't load it; their CSP only allows their own origin.

export const ASSET_SCHEME = 'cockpit-asset'

const encodePath = (p: string): string =>
  p
    .split('/')
    .filter((s) => s && s !== '.' && s !== '..')
    .map(encodeURIComponent)
    .join('/')

/** A file in ~/.cockpit/themes/<id>/. */
export function themeAssetUrl(themeId: string, file: string, revision?: number): string {
  const v = revision === undefined ? '' : `?v=${String(revision)}`
  return `${ASSET_SCHEME}://themes/${encodeURIComponent(themeId)}/${encodePath(file)}${v}`
}

/** A file in ~/.cockpit/images/. */
export function imageUrl(file: string, revision?: number): string {
  const v = revision === undefined ? '' : `?v=${String(revision)}`
  return `${ASSET_SCHEME}://images/${encodePath(file)}${v}`
}
