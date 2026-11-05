# Layouts

A layout says where the window's panels go: the terminals, the tab bar, the
session list, Activity, widgets, and the clock, image, and System panels. Pick
one from View > Layout. Dragging the line between two panels, folding a panel,
or switching a group between stacked and tabs saves your own copy of that
layout in `config.json`. View > Layout > Reset Layout deletes the copy.

Each window picks its own layout, so View > Layout changes the window in
front.

```jsonc
"appearance": {
  "layouts": {
    "classic": { /* your copy, written when you changed it */ },
    "wide": { /* one you wrote; it shows up in View > Layout */ }
  }
},
"windows": [
  { "id": "main", "layout": "classic", "panelsHidden": false, "tabs": [/* ... */] },
  { "id": "w2", "layout": "panels", "panelsHidden": false, "tabs": [] }
]
```

`windows` also keeps each window's tabs, `bounds`, and `display`; Cockpit
writes those, and a hand edit to them while it runs is ignored. A window's
`layout` and `panelsHidden` can be edited by hand. Before version 4 of the
file, the one window's layout and `panelsHidden` were in `appearance`, and
its tabs were the top-level `layout`.

`panelsHidden` is what Cmd+B toggles: every panel but the terminals and the
tab bar is hidden. The toolbar along the bottom isn't part of the layout and
stays where it is. Edits to `config.json` apply while Cockpit runs. A layout
change never restarts a terminal or reloads a widget, since both are drawn
once and placed over the spot the layout gives them.

## The tree

A layout is a tree of three kinds of node.

**`split`** lays out its `children` side by side (`"direction": "row"`) or
stacked (`"direction": "column"`).

**`tabs`** shows one of its `children` at a time, with a row of tabs on top.
`active` is the id of the one shown.

**`panel`** is a leaf. `panel` names which:

| `panel`     | Shows                                                                                     | Options                                                           |
| ----------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `workspace` | The terminals, or the start screen when no tab is open. Exactly one, or none (see below). | –                                                                 |
| `tabbar`    | The terminal tabs. Exactly one, or none.                                                  | –                                                                 |
| `sessions`  | Every pane with its status.                                                               | –                                                                 |
| `activity`  | What the focused pane's agent did. Absent when no pane has focus.                         | `tab`: `log`, `files`, `agents`, or `git`                         |
| `widget`    | One widget. Each widget can appear once.                                                  | `widget`: the widget's id                                         |
| `clock`     | The time and date, in the theme's accent.                                                 | `seconds`, `date` (both default true), `hour12` (default: locale) |
| `image`     | An image or animated GIF, or the built-in head-up display.                                | `src`, `fit` (`cover` or `contain`), `position`, `pixelated`      |
| `monitor`   | CPU, memory, load averages, and uptime, read every 2 seconds while it's on screen.        | –                                                                 |
| `prs`       | Open pull requests of the focused pane's repository, through `gh`.                        | –                                                                 |
| `commands`  | Claude Code slash commands for the focused pane's repository and everywhere.              | –                                                                 |

An image's `src` is a file in `~/.cockpit/images/`, or `theme:<file>` for one
in the current theme's folder. Without an extension, Cockpit tries `.gif`,
`.png`, `.webp`, `.jpg`, `.jpeg`, `.avif`, `.apng`, and `.svg` in that order,
so `"src": "banner"` finds `banner.gif`. The image reloads when the file
changes. `position` is a CSS `object-position` such as `top left` or `50% 20%`;
`pixelated` keeps pixel art sharp when it's scaled.

`"src": "builtin:hud"` shows the built-in head-up display instead of a file,
and so does `"src": "banner"` (the default) while `~/.cockpit/images/` has no
banner. It's drawn in the theme's colors:

![The head-up display, with five agent sessions as traffic](images/hud.png)

- A heading tape across the top and a horizon with a pitch ladder, drifting
  through a calm flight around the flight path marker in the middle.
- A traffic blip for each agent pane, in tab order from left to right: a
  diamond, pulsing while it works, filled green when it's done, and hollow
  when it's idle, or a blinking circle when it needs you. Its folder is below
  it, its context size above, and the focused pane has brackets around it.
  When they don't all fit, the rightmost slot says how many more there are.
- Lights along the bottom edge that count panes working, needing input, and
  done, and in the bottom right, the context of every agent added up.

It holds still when Reduce motion is on in macOS, and stops moving while it's
off screen.

### Layouts without terminals

A root `split` or `tabs` node with `"terminals": false` has no terminals and no
tab bar: `workspace` and `tabbar` panels in it are dropped and none are added.
It's for a window on another display, beside the ones with terminals. The
built-in Panels layout is one. Widgets that no window's layout places go to
the first window with such a layout.

```json
{
  "type": "split",
  "direction": "row",
  "terminals": false,
  "children": [
    { "type": "panel", "panel": "activity" },
    { "type": "panel", "panel": "widget", "widget": "shortcut-stories", "size": 400 }
  ]
}
```

Every node may have an `id`. Cockpit makes up ids for nodes without one, from
their kind (`workspace`, `tabbar`, `widget:<id>`) or their place in the tree.

### Sizes

Each child of a split takes room along the split's direction in one of three
ways:

- `"size": 320` is a width (in a row) or a height (in a column) in pixels.
- No `size` shares the room left over with the other children that have none,
  in proportion to `flex` (default 1).
- `"size": "auto"` fits the content, up to `max`: pixels, or a fraction of the
  split when 1 or less (`"max": 0.4`).

The tab bar, the session list, the System panel, and widgets whose manifest
says `"sizing": "content"` fit their content unless given a size. A column
whose children all fit their content (or are folded) fits its content too.
When no child of a split shares leftover room, the ones with a pixel size grow
to fill it. That way Activity fills its column when no widget below it takes
up height.

`"collapsed": true` folds a panel to its title row. Folding only works in a
column.

### Groups and widgets

A `split` or `tabs` node with a `title` gets a title row, with a button that
switches it between a stacked column and tabs. One node has
`"widgets": "rest"`. Installed widgets that the layout doesn't place go at
its end, so a new widget always shows up somewhere. If no node has it, Cockpit
picks the group with the most widgets, or adds a Widgets column on the right.

### Repairs

A layout read from `config.json` is repaired rather than refused. Unknown
panels and bad options are dropped, sizes are clamped, a second `workspace`,
`tabbar`, or copy of a widget is dropped, and a missing tab bar is put above
the terminals. A split with one child is replaced by that child, keeping the
split's size.

### The window's edges

The window drags by whatever touches its top edge: the tab bar, a title row,
or an image or clock panel. Whatever sits in the top left corner leaves room
for the traffic lights.

## Example

The built-in Cockpit layout:

```json
{
  "type": "split",
  "id": "root",
  "direction": "column",
  "children": [
    {
      "type": "split",
      "id": "banner",
      "direction": "row",
      "size": 180,
      "children": [
        { "type": "panel", "id": "image", "panel": "image", "src": "banner", "flex": 3 },
        { "type": "panel", "id": "clock", "panel": "clock", "flex": 1 }
      ]
    },
    { "type": "panel", "id": "tabbar", "panel": "tabbar" },
    {
      "type": "split",
      "id": "main",
      "direction": "row",
      "children": [
        { "type": "panel", "id": "activity", "panel": "activity", "size": 300, "tab": "log" },
        { "type": "panel", "id": "workspace", "panel": "workspace" },
        {
          "type": "split",
          "id": "sidebar",
          "direction": "column",
          "size": 340,
          "children": [
            { "type": "panel", "id": "sessions", "panel": "sessions", "max": 0.4 },
            { "type": "panel", "id": "monitor", "panel": "monitor" },
            {
              "type": "split",
              "id": "widgets",
              "direction": "column",
              "title": "Widgets",
              "widgets": "rest",
              "children": []
            }
          ]
        }
      ]
    }
  ]
}
```

To put two widgets in tabs at the bottom of the terminals, replace the
`workspace` panel above with:

```json
{
  "type": "split",
  "direction": "column",
  "children": [
    { "type": "panel", "panel": "workspace" },
    {
      "type": "tabs",
      "size": 260,
      "children": [
        { "type": "panel", "panel": "widget", "widget": "shortcut-stories" },
        { "type": "panel", "panel": "widget", "widget": "hello" }
      ]
    }
  ]
}
```
