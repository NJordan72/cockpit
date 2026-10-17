# Themes

A theme sets Cockpit's colors, fonts, corner radius, spacing, and effects, and
the terminal's palette. The chrome, the terminals, and widgets all follow it.
Pick one from View > Theme, or set it in `config.json`:

```jsonc
"appearance": {
  "theme": "amber",
  "overrides": { "accent": "#ff9e64" }
}
```

`overrides` changes single tokens on top of whichever theme is in use. Edits
to `config.json` and to theme files apply while Cockpit runs.

## Built-in themes

| Id         | Look                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------- |
| `midnight` | The default: blue accent on dark gray.                                                         |
| `amber`    | Cream text and an amber accent on black, monospace UI, square corners, CRT scanlines and glow. |
| `paper`    | Dark text on a light, warm background.                                                         |

## Making a theme

A theme is a folder in `~/.cockpit/themes/`, named with lowercase letters,
digits, `-` and `_`. The folder (or a symlink to one) holds `theme.json`:

```json
{
  "name": "Neon",
  "extends": "amber",
  "tokens": { "accent": "#39ff14", "accentFg": "#000000" },
  "terminal": { "cursor": "#39ff14" }
}
```

- `name` is what View > Theme shows.
- `extends` names another theme, built in or in the folder. Its tokens,
  palette, and stylesheet apply first, so a theme only lists what it changes.
  Chains can go four themes deep.
- `tokens` and `terminal` are described below. Unknown keys are ignored, and
  so are values containing `;`, `{`, `}`, `<`, `>` or `\`.
- `css` names a stylesheet in the folder. It defaults to `theme.css`, which is
  used when it exists.

A folder that can't be read still shows in View > Theme, greyed out, with the
reason as its tooltip.

### Tokens

Each token becomes a CSS variable in the chrome and in every widget:
`bgRaised` is `--bg-raised`.

| Token                                               | What it sets                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------------- |
| `bg`, `bgRaised`, `bgHover`                         | Backgrounds: panels, raised controls, hovered rows                         |
| `fg`, `muted`                                       | Text, and secondary text                                                   |
| `border`                                            | Lines between and around panels                                            |
| `accent`, `accentFg`                                | Highlights, and text drawn on an accent background                         |
| `danger`                                            | Errors                                                                     |
| `red`, `green`, `yellow`, `blue`, `magenta`, `cyan` | Status colors, and the terminal's base colors                              |
| `colorScheme`                                       | `dark` or `light`, for native controls and scrollbars                      |
| `fontUi`, `fontMono`, `fontSize`                    | Font stacks and the base UI size. `fontMono` defaults to the terminal font |
| `headerCase`, `headerTracking`, `headerWeight`      | Panel titles: `text-transform`, `letter-spacing`, `font-weight`            |
| `headerHeight`                                      | Height of panel title rows                                                 |
| `radius`                                            | Corner radius of buttons, inputs, and dialogs (`0px` for square)           |
| `gap`                                               | Space between panels                                                       |
| `scanlines`, `glow`, `vignette`                     | Effects, from `0` (off) to `1`                                             |

A token can refer to another one: Amber sets `fontUi` to `var(--font-mono)`.

### Terminal palette

`terminal` sets xterm's colors: `background`, `foreground`, `cursor`,
`cursorAccent`, `selectionBackground`, `selectionForeground`, and the 16 ANSI
colors (`black`, `red`, ... `white`, `brightBlack`, ... `brightWhite`). Colors
it leaves out come from the tokens: the background and text from `bg` and
`fg`, `red` from `red`, and so on. Use `#rrggbb` or `rgb()` here; xterm can't
read `var()` or `color-mix()`.

### Stylesheet

The stylesheet loads after Cockpit's own, so its rules win. The `<html>`
element carries the theme and everything it extends in `data-theme` (for
example `data-theme="amber neon"`), so a rule can apply to one theme's
descendants with `[data-theme~='neon']`. Relative `url()`s load from the theme
folder, for images and fonts:

```css
@font-face {
  font-family: 'Pixel';
  src: url('fonts/pixel.woff2');
}
.titlebar {
  background: url('stripe.svg') repeat-x;
}
```

Theme folders can serve stylesheets, images (PNG, JPEG, GIF, WebP, AVIF, SVG),
and fonts (WOFF, WOFF2, TTF, OTF). A file has to stay inside the folder; a
symlink pointing outside it isn't served.

A stylesheet runs with the chrome's full access to its own page. It can
restyle or hide anything in Cockpit's window, but it can't run scripts or load
anything from the network, and widgets can't read theme files. Use themes you
trust, as with widgets.
