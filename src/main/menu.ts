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
}

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
      // Built by hand: the stock window menu binds Cmd+W, which closes panes here.
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
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
