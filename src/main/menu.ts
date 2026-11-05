import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import type { ThemeDefinition } from '@shared/theme'

export interface MenuHandlers {
  onAbout: () => void
  onKidsMode: () => void
  themes: ThemeDefinition[]
  /** The theme in use. */
  theme: string
  onTheme: (id: string) => void
  layouts: { id: string; name: string }[]
  /** The layout in use. */
  layout: string
  onLayout: (id: string) => void
  onResetLayout: () => void
  /** The layout in use is built in and has been changed. */
  canResetLayout: boolean
  onTogglePanels: () => void
  onOpenFolder: () => void
  /** Windows open now. */
  windows: number
  /** Displays connected now. */
  displays: number
  /** Open or close windows to make `count`, and arrange them on the displays. */
  onWindows: (count: number) => void
}

const WINDOW_COUNTS = ['One Window', 'Two Windows', 'Three Windows']

/**
 * A minimal macOS menu. Copy and paste are handled by the terminal itself so
 * they work on xterm's selection; the Edit roles here are for text inputs in
 * the chrome. Terminal shortcuts (Cmd+K, Cmd+T, ...) are deliberately absent
 * so the renderer receives them.
 */
export function buildMenu(handlers: MenuHandlers): Menu {
  const themeItems: MenuItemConstructorOptions[] = handlers.themes.map((t) => ({
    id: `theme:${t.id}`,
    label: t.error ? `${t.name} (can't be read)` : t.name,
    toolTip: t.error,
    type: 'radio',
    checked: t.id === handlers.theme,
    enabled: !t.error,
    click: () => handlers.onTheme(t.id)
  }))
  const layoutItems: MenuItemConstructorOptions[] = [
    ...handlers.layouts.map((l): MenuItemConstructorOptions => ({
      id: `layout:${l.id}`,
      label: l.name,
      type: 'radio',
      checked: l.id === handlers.layout,
      click: () => handlers.onLayout(l.id)
    })),
    { type: 'separator' },
    {
      id: 'layout-reset',
      label: 'Reset Layout',
      enabled: handlers.canResetLayout,
      click: handlers.onResetLayout
    }
  ]
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { label: 'About Cockpit', click: handlers.onAbout },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Theme', submenu: themeItems },
        { label: 'Layout', submenu: layoutItems },
        // No accelerator: Cmd+B (toggleSidebar) is the chrome's, and can be rebound.
        { id: 'toggle-panels', label: 'Toggle Panels', click: handlers.onTogglePanels },
        { type: 'separator' },
        { label: 'Kids Mode', click: handlers.onKidsMode },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { label: 'Open Cockpit Folder', click: handlers.onOpenFolder }
      ]
    },
    {
      // Built by hand: the stock window menu binds Cmd+W, which closes panes
      // here. The role still makes it macOS's Window menu, which lists the
      // windows and offers to move one to another display.
      label: 'Window',
      role: 'window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        ...WINDOW_COUNTS.map((label, i): MenuItemConstructorOptions => ({
          id: `windows:${String(i + 1)}`,
          label,
          type: 'radio',
          checked: handlers.windows === i + 1,
          click: () => handlers.onWindows(i + 1)
        })),
        {
          id: 'windows-arrange',
          label:
            handlers.displays > 1
              ? `Arrange Windows on ${String(handlers.displays)} Displays`
              : 'Arrange Windows',
          click: () => handlers.onWindows(handlers.windows)
        },
        { type: 'separator' },
        { role: 'front' }
      ]
    }
  ]
  return Menu.buildFromTemplate(template)
}

/**
 * The menu while kids mode is on. Kiosk mode hides the menu bar, but menu
 * shortcuts would still fire, so there is nothing here to quit, hide, close,
 * minimize, or reload with.
 */
export function buildKidsMenu(handlers: { onAbout: () => void }): Menu {
  return Menu.buildFromTemplate([
    { label: app.name, submenu: [{ label: 'About Cockpit', click: handlers.onAbout }] }
  ])
}

/**
 * A context menu the chrome asked for, rebuilt from plain fields so nothing
 * but labels, ids, and nesting comes across IPC. Items without a string id
 * and label are dropped; menus nest at most three deep.
 */
export function menuTemplate(
  items: readonly unknown[],
  choose: (id: string) => void,
  depth = 0
): MenuItemConstructorOptions[] {
  const out: MenuItemConstructorOptions[] = []
  for (const item of items.slice(0, 50)) {
    if (typeof item !== 'object' || item === null) continue
    const i = item as Record<string, unknown>
    if (i.type === 'separator') {
      out.push({ type: 'separator' })
    } else if (typeof i.label !== 'string') {
      continue
    } else if (Array.isArray(i.submenu) && depth < 2) {
      out.push({ label: i.label, submenu: menuTemplate(i.submenu, choose, depth + 1) })
    } else if (typeof i.id === 'string') {
      const id = i.id
      const item: MenuItemConstructorOptions = {
        label: i.label,
        enabled: i.enabled !== false,
        click: () => choose(id)
      }
      if (typeof i.checked === 'boolean') {
        item.type = 'checkbox'
        item.checked = i.checked
      }
      out.push(item)
    }
  }
  return out
}
