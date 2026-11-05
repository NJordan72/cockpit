/**
 * Makes every canvas context trim whitespace from a font before applying it.
 * Chromium 156 ignores a font that starts with whitespace, such as
 * `' normal 26px monospace'`, and keeps drawing in its default 10px sans-serif. xterm's WebGL renderer sets
 * fonts in that form for every glyph that isn't italic, so without this the
 * terminal draws tiny letters spread across full-size cells.
 */
export function trimCanvasFonts(): void {
  for (const proto of [
    CanvasRenderingContext2D.prototype,
    OffscreenCanvasRenderingContext2D.prototype
  ]) {
    const font = Object.getOwnPropertyDescriptor(proto, 'font')
    if (!font?.set) continue
    Object.defineProperty(proto, 'font', {
      ...font,
      set(value: unknown) {
        font.set?.call(this, typeof value === 'string' ? value.trim() : value)
      }
    })
  }
}
