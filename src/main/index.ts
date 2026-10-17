import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  session,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import { migrateConfig, type Layout, type LayoutNode, type SidebarSettings } from '@shared/config'
import { IPC, type DirListing, type PtyCreateOptions, type PtyCreated } from '@shared/ipc'
import { resolveTheme } from '@shared/theme'
import { ConfigStore } from './config'
import { listProjects, processCwd, processCwdSync, resolveCwd } from './dirs'
import { buildMenu } from './menu'
import { abbreviateHome, cockpitHome } from './paths'
import { PtyManager } from './pty'
import { registerWidgetScheme, WidgetHost } from './widgets/host'
import { listSessions } from './widgets/sessions'

const ptys = new PtyManager(() => widgets.sessionsChanged())
let config: ConfigStore
let widgets: WidgetHost
let mainWindow: BrowserWindow | null = null

registerWidgetScheme()

/** Record where each live pane's process is now, so a relaunch reopens it there. */
function captureCwds(): void {
  const pids = ptys.pids()
  if (pids.size === 0) return
  const update = (n: LayoutNode): LayoutNode => {
    if (n.type === 'split') return { ...n, children: n.children.map(update) }
    const pid = pids.get(n.id)
    const cwd = pid === undefined ? null : processCwdSync(pid)
    return cwd ? { ...n, cwd: abbreviateHome(cwd) } : n
  }
  const layout = config.get().layout
  config.setLayout({ ...layout, tabs: layout.tabs.map((t) => ({ ...t, root: update(t.root) })) })
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 480,
    minHeight: 300,
    show: false,
    backgroundColor: '#1e1f24',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })
  mainWindow = win

  win.once('ready-to-show', () => win.show())

  // The chrome is a single page. Anything that tries to navigate away or open
  // a window is a link the user clicked; send http(s) ones to the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  const wc = win.webContents
  widgets.attach(wc)
  // A reload starts the renderer over; its old PTYs have no view any more.
  wc.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      ptys.killAllFor(wc)
      widgets.detach(wc)
    }
  })
  win.on('close', () => {
    captureCwds()
  })
  win.on('closed', () => {
    ptys.killAllFor(wc)
    widgets.detach(wc)
    if (mainWindow === win) mainWindow = null
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Only accept IPC from our own top-level chrome frame. */
function trusted(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const frame = e.senderFrame
  if (!frame || frame.parent) return false
  return BrowserWindow.fromWebContents(e.sender) !== null
}

function registerIpc(): void {
  ipcMain.handle(IPC.ptyCreate, async (e, opts: PtyCreateOptions): Promise<PtyCreated> => {
    if (!trusted(e)) throw new Error('untrusted sender')
    const preset = config.get().presets.find((p) => p.id === opts.presetId)
    if (!preset) throw new Error(`unknown preset: ${opts.presetId}`)
    const cwd = await resolveCwd(opts.cwd, preset.cwd)
    const { pid } = ptys.create(e.sender, {
      id: opts.id,
      cols: opts.cols,
      rows: opts.rows,
      command: preset.command,
      cwd
    })
    const display = abbreviateHome(cwd)
    if (display !== '~') config.addRecentDir(display)
    widgets.sessionsChanged()
    return { pid, cwd: display }
  })
  ipcMain.on(IPC.ptyWrite, (e, id: string, data: string) => {
    if (trusted(e)) ptys.write(id, data)
  })
  ipcMain.on(IPC.ptyResize, (e, id: string, cols: number, rows: number) => {
    if (trusted(e)) ptys.resize(id, cols, rows)
  })
  ipcMain.on(IPC.ptyKill, (e, id: string) => {
    if (trusted(e)) ptys.kill(id)
  })
  ipcMain.handle(IPC.ptyCwd, async (e, id: string) => {
    if (!trusted(e)) return null
    const pid = ptys.pid(id)
    const cwd = pid === null ? null : await processCwd(pid)
    return cwd ? abbreviateHome(cwd) : null
  })
  ipcMain.handle(IPC.clipboardRead, (e) => (trusted(e) ? clipboard.readText() : ''))
  ipcMain.on(IPC.clipboardWrite, (e, text: string) => {
    if (trusted(e) && typeof text === 'string') void clipboard.writeText(text)
  })
  ipcMain.handle(IPC.configGet, (e) => {
    if (!trusted(e)) throw new Error('untrusted sender')
    return config.get()
  })
  ipcMain.on(IPC.layoutSave, (e, layout: Layout) => {
    if (!trusted(e)) return
    // Run it through migration so a bad layout can't corrupt the file.
    config.setLayout(migrateConfig({ ...config.get(), layout }).layout)
    widgets.sessionsChanged()
  })
  ipcMain.on(IPC.sidebarSave, (e, sidebar: SidebarSettings) => {
    if (trusted(e)) config.setSidebar(sidebar)
  })
  ipcMain.handle(IPC.dirsList, async (e): Promise<DirListing> => {
    if (!trusted(e)) throw new Error('untrusted sender')
    const c = config.get()
    return { recent: c.recentDirs, projects: await listProjects(c.projectsDir) }
  })
}

/**
 * Nothing in a renderer needs the network: cockpit.fetch runs here in main,
 * and links open in the browser. Sending the session through a proxy that
 * doesn't exist cuts off what CSP can't, such as WebRTC to a TURN server
 * (UDP is already off; see WidgetHost.attach). The dev server is on
 * localhost, so loopback stays direct in dev.
 */
async function cutRendererNetwork(): Promise<void> {
  const dev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL
  await session.defaultSession.setProxy({
    mode: 'fixed_servers',
    proxyRules: '127.0.0.1:9',
    proxyBypassRules: dev ? '' : '<-loopback>'
  })
}

void app.whenReady().then(async () => {
  // Chrome needs no browser permissions; widgets get theirs through the broker.
  app.on('web-contents-created', (_e, contents) => {
    contents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
    contents.on('will-attach-webview', (ev) => ev.preventDefault())
  })
  // Permission checks (as opposed to requests) keep their default for the
  // chrome; widget frames are refused everything, devices included.
  session.defaultSession.setPermissionCheckHandler((_wc, _perm, _origin, details) => {
    return details.isMainFrame
  })
  session.defaultSession.setDevicePermissionHandler(() => false)
  await cutRendererNetwork()

  config = new ConfigStore((c) => {
    mainWindow?.webContents.send(IPC.configChanged, c)
  })
  config.watch()

  widgets = new WidgetHost({
    home: cockpitHome(),
    trusted,
    theme: () => {
      const c = config.get()
      return resolveTheme(c.theme, c.terminal.fontFamily)
    },
    sessions: () => {
      const c = config.get()
      return listSessions(c.layout, c.presets, new Set(ptys.pids().keys()))
    }
  })
  widgets.start()

  Menu.setApplicationMenu(buildMenu())
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  ptys.killAll()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  captureCwds()
  ptys.killAll()
})

app.on('will-quit', () => {
  config.close()
  widgets.close()
})
