import { app, Menu, type MenuItemConstructorOptions } from 'electron'

/**
 * A minimal macOS menu. Copy and paste are handled by the terminal itself so
 * they work on xterm's selection; the Edit roles here are for text inputs in
 * the chrome. Terminal shortcuts (Cmd+K, Cmd+T, ...) are deliberately absent
 * so the renderer receives them.
 */
export function buildMenu(onKidsMode: () => void): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
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
        { label: 'Kids Mode', click: onKidsMode },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
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
export function buildKidsMenu(): Menu {
  return Menu.buildFromTemplate([{ label: app.name, submenu: [{ role: 'about' }] }])
}
