import { basename, join } from 'node:path'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  session,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import {
  migrateConfig,
  paneIds,
  type LauncherSettings,
  type Layout,
  type LayoutNode,
  type PaneNode,
  type SidebarSettings
} from '@shared/config'
import {
  IPC,
  type DirListing,
  type PaneSession,
  type PtyCreateOptions,
  type PtyCreated
} from '@shared/ipc'
import { resolveTheme } from '@shared/theme'
import { AgentMonitor } from './agents/monitor'
import { ConfigStore } from './config'
import { listDirs, processCwd, processCwdSync, resolveCwd } from './dirs'
import { gitStatus } from './git'
import { buildMenu } from './menu'
import { abbreviateHome, claudeHome, cockpitHome, codexHome, expandHome } from './paths'
import { PtyManager } from './pty'
import { registerWidgetScheme, WidgetHost } from './widgets/host'
import { listSessions, widgetSession } from './widgets/sessions'

// PTYs only start once the app is ready, by which time agents exists.
const ptys = new PtyManager({
  output: (id, data) => agents.output(id, data),
  input: (id, data) => agents.input(id, data),
  resized: (id) => agents.resized(id),
  exited: (id) => agents.exited(id),
  killed: (id) => agents.killed(id)
})
let config: ConfigStore
let widgets: WidgetHost
let agents: AgentMonitor
let mainWindow: BrowserWindow | null = null
let lastSessions = ''
let warnedNotifications = false
/**
 * The chrome opens on the start screen, where the saved layout is only
 * offered for restoring. Its panes are live once the chrome sends a layout.
 */
let layoutShown = false

registerWidgetScheme()

const NO_LAYOUT: Layout = { tabs: [], activeTabId: null }

/** The layout on screen: the saved one, once the chrome has shown it. */
function liveLayout(): Layout {
  return layoutShown ? config.get().layout : NO_LAYOUT
}

function sessions(): PaneSession[] {
  return listSessions(liveLayout(), config.get().presets, (id) => agents.status(id))
}

/** Push the session list to the chrome and to widgets that read it, if it changed. */
function sessionsChanged(): void {
  const list = sessions()
  const json = JSON.stringify(list)
  if (json !== lastSessions) {
    lastSessions = json
    mainWindow?.webContents.send(IPC.sessionsChanged, list)
    // The Dock shows how many panes want the user, notifications or not.
    const waiting = list.filter((s) => s.status === 'needs-input' || s.status === 'done').length
    app.dock?.setBadge(waiting > 0 ? String(waiting) : '')
  }
  widgets.sessionsChanged()
}

function findPaneNode(id: string): PaneNode | null {
  const find = (n: LayoutNode): PaneNode | null =>
    n.type === 'pane' ? (n.id === id ? n : null) : (n.children.map(find).find(Boolean) ?? null)
  for (const tab of liveLayout().tabs) {
    const pane = find(tab.root)
    if (pane) return pane
  }
  return null
}

/** Tell the monitor which pane the user is looking at, so a finished turn counts as seen. */
function updateFocus(): void {
  const win = mainWindow
  if (!win?.isFocused()) {
    agents.setFocused(null)
    return
  }
  const layout = liveLayout()
  const tab = layout.tabs.find((t) => t.id === layout.activeTabId)
  agents.setFocused(tab && paneIds(tab.root).includes(tab.activePaneId) ? tab.activePaneId : null)
}

/** A notification was clicked: bring the window forward and focus its pane. */
function revealPane(paneId: string): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  app.focus({ steal: true })
  win.focus()
  win.webContents.send(IPC.paneFocus, paneId)
}

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
  win.on('focus', updateFocus)
  win.on('blur', updateFocus)

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
      lastSessions = ''
      layoutShown = false
    }
  })
  win.on('close', () => {
    captureCwds()
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
    layoutShown = false
    ptys.killAllFor(wc)
    widgets.detach(wc)
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
    const launch = agents.launch(preset.command)
    const env = agents.spawn(opts.id, launch.agent)
    let pid: number
    try {
      ;({ pid } = ptys.create(e.sender, {
        id: opts.id,
        cols: opts.cols,
        rows: opts.rows,
        command: launch.command,
        cwd,
        env
      }))
    } catch (err) {
      agents.killed(opts.id)
      throw err
    }
    const display = abbreviateHome(cwd)
    if (display !== '~') config.addRecentDir(display, preset.id)
    sessionsChanged()
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
    layoutShown = true
    updateFocus()
    sessionsChanged()
  })
  ipcMain.handle(IPC.sessionsList, (e) => {
    if (!trusted(e)) throw new Error('untrusted sender')
    return sessions()
  })
  ipcMain.handle(IPC.activityGet, (e, paneId: unknown) => {
    if (!trusted(e) || typeof paneId !== 'string') throw new Error('untrusted sender')
    return agents.activity.snapshot(paneId)
  })
  ipcMain.handle(IPC.activityGit, async (e, paneId: unknown) => {
    if (!trusted(e) || typeof paneId !== 'string') return null
    const pane = findPaneNode(paneId)
    if (!pane) return null
    // Where Claude's hooks say it runs; otherwise where the process is now
    // (a shell may have cd'd); otherwise where the pane started.
    let cwd = agents.activity.cwd(pane.id)
    if (!cwd) {
      const pid = ptys.pid(pane.id)
      cwd = pid === null ? null : await processCwd(pid)
    }
    return gitStatus(cwd ?? expandHome(pane.cwd))
  })
  ipcMain.on(IPC.sidebarSave, (e, sidebar: SidebarSettings) => {
    if (trusted(e)) config.setSidebar(sidebar)
  })
  ipcMain.on(IPC.launcherSave, (e, launcher: LauncherSettings) => {
    if (trusted(e)) config.setLauncher(launcher)
  })
  ipcMain.handle(IPC.dirsList, async (e): Promise<DirListing> => {
    if (!trusted(e)) throw new Error('untrusted sender')
    return { dirs: await listDirs(config.get(), { claude: claudeHome(), codex: codexHome() }) }
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

/** Everything that needs the app to be ready. */
async function startup(): Promise<void> {
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
    sessions: () => sessions().map(widgetSession)
  })
  widgets.start()

  agents = new AgentMonitor({
    home: cockpitHome(),
    onChange: sessionsChanged,
    onActivity: (update) => mainWindow?.webContents.send(IPC.activityUpdate, update),
    windowFocused: () => mainWindow?.isFocused() ?? false,
    describe: (paneId) => {
      const pane = findPaneNode(paneId)
      if (!pane) return null
      const preset = config.get().presets.find((p) => p.id === pane.presetId)
      return { name: preset?.name ?? pane.presetId, place: basename(pane.cwd) || pane.cwd }
    },
    onClick: revealPane,
    onFailed: (error) => {
      // Without notifications, a bounce is the next best way to say so.
      app.dock?.bounce('informational')
      if (warnedNotifications) return
      warnedNotifications = true
      console.warn(
        `macOS refused a notification (${error}). Allow notifications for this app in ` +
          'System Settings > Notifications; an unsigned development build may not be allowed at all.'
      )
    }
  })
  try {
    await agents.start()
  } catch (err) {
    // Hooks can't report without the socket; the output heuristic still works.
    console.error('agent event server failed to start:', err)
  }

  Menu.setApplicationMenu(buildMenu())
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

void app
  .whenReady()
  .then(startup)
  .catch((err: unknown) => {
    // Without config there is nothing to show; say why instead of idling windowless.
    console.error('Cockpit could not start:', err)
    dialog.showErrorBox('Cockpit could not start', err instanceof Error ? err.message : String(err))
    app.exit(1)
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
  // A startup that failed partway leaves some of these unset.
  const parts = [config, widgets, agents] as ({ close: () => void } | undefined)[]
  for (const part of parts) part?.close()
})
