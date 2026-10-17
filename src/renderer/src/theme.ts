import { themeVars, type ResolvedTheme, type ThemeDefinition } from '@shared/theme'

/** Effects whose CSS costs something even at 0, so it only applies when on. */
const EFFECTS = ['scanlines', 'glow', 'vignette'] as const

/** The ids `theme` builds on, base first, for `[data-theme~=...]` rules. */
function lineage(themes: readonly ThemeDefinition[], id: string): string[] {
  const byId = new Map(themes.map((t) => [t.id, t]))
  const ids: string[] = []
  for (
    let t = byId.get(id);
    t && !ids.includes(t.id);
    t = t.extends ? byId.get(t.extends) : undefined
  )
    ids.unshift(t.id)
  return ids
}

/** Put a theme on the chrome: its variables, its stylesheets, and markers for CSS. */
export function applyTheme(theme: ResolvedTheme, themes: readonly ThemeDefinition[]): void {
  const root = document.documentElement
  for (const [name, value] of Object.entries(themeVars(theme.tokens))) {
    root.style.setProperty(name, value)
  }
  root.dataset.theme = lineage(themes, theme.id).join(' ')
  root.dataset.effects = EFFECTS.filter((k) => Number.parseFloat(theme.tokens[k]) > 0).join(' ')
  // A gap between panels draws each as a box; without one, neighbours share a line.
  if (Number.parseFloat(theme.tokens.gap) > 0) root.dataset.boxed = ''
  else delete root.dataset.boxed

  // Theme stylesheets come last, so they win over the app's own rules.
  const current = [...document.head.querySelectorAll<HTMLLinkElement>('link[data-theme-css]')]
  const wanted = theme.css
  if (current.map((l) => l.getAttribute('href')).join('\n') === wanted.join('\n')) return
  // Add the new ones before removing the old, so there's no unstyled flash.
  const added = wanted.map((href) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.dataset.themeCss = ''
    document.head.append(link)
    return link
  })
  const swap = (): void => {
    for (const l of current) l.remove()
  }
  if (added.length === 0) swap()
  else
    void Promise.all(
      added.map(
        (l) =>
          new Promise((resolve) => {
            l.addEventListener('load', resolve, { once: true })
            l.addEventListener('error', resolve, { once: true })
          })
      )
    ).then(swap)
}
