import './fonts.css'

const FACES = [
  '13px "0xProto Nerd Font Mono"',
  'bold 13px "0xProto Nerd Font Mono"',
  'italic 13px "0xProto Nerd Font Mono"',
  '13px "Symbols Nerd Font Mono"'
]

/**
 * Loads the bundled terminal fonts. xterm measures cells and rasterizes glyphs
 * when a terminal opens and doesn't redraw when a font arrives later, so this
 * has to finish first. A face that fails to load falls back like any font.
 */
export async function loadFonts(): Promise<void> {
  await Promise.all(FACES.map((f) => document.fonts.load(f).catch(() => undefined)))
}
