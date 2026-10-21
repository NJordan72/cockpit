import { realpathSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  session,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
  type WebPreferences
} from 'electron'
import {
  migrateConfig,
  paneIds,
  type AppearanceSettings,
  type LauncherSettings,
  type Layout,
  type LayoutNode,
  type PaneNode
} from '@shared/config'
import {
  IPC,
  type AppearanceCommand,
  type DirListing,
  type KidsCharacter,
  type PaneSession,
  type PtyCreateOptions,
  type PtyCreated
} from '@shared/ipc'
import type { SaveResult } from '@shared/commands'
import type { PrList } from '@shared/prs'
import { BUILT_IN_LAYOUTS, layoutChoices } from '@shared/layouts'
import { resolveTheme, type ResolvedTheme } from '@shared/theme'
import { canOpenExternally, isWebUrl, WEB_PARTITION } from '@shared/web'
import { AgentMonitor } from './agents/monitor'
import { serveAssets } from './assets'
import { ConfigStore } from './config'
import { listDirs, processCwd, processCwdSync, resolveCwd } from './dirs'
import { deleteCommand, listCommands, saveCommand } from './commands'
import { gitStatus } from './git'
import { listCharacters } from './kids'
import { buildKidsMenu, buildMenu, menuTemplate } from './menu'
import { abbreviateHome, claudeHome, cockpitHome, codexHome, expandHome } from './paths'
import { listPrs } from './prs'
import { PtyManager } from './pty'
import { registerSchemes } from './schemes'
import { SystemMonitor } from './system'
import { ThemeStore } from './themes'
import { TreeWatcher } from './watch'
import { WidgetHost } from './widgets/host'
import iconPath from '../../resources/icon.png?asset'
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
let themes: ThemeStore
let images: TreeWatcher
let imagesRevision = 0
const system = new SystemMonitor((sample) => {
  const win = mainWindow
  if (win && !win.isDestroyed()) win.webContents.send(IPC.systemSample, sample)
})
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
/**
 * Kids mode is on: the window is in kiosk mode, the menu has no shortcuts, and
 * nothing typed reaches a PTY. Main owns this, so it survives a chrome reload.
 */
let kidsActive = false

registerSchemes()

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

/** Where a pane's agent runs now: as its hooks last said, else its process's cwd, else where it started. */
async function paneCwd(paneId: string): Promise<string | null> {
  const pane = findPaneNode(paneId)
  if (!pane) return null
  let cwd = agents.activity.cwd(pane.id)
  if (!cwd) {
    const pid = ptys.pid(pane.id)
    cwd = pid === null ? null : await processCwd(pid)
  }
  return cwd ?? expandHome(pane.cwd)
}

/** Longest prompt a panel or widget may type into a pane. */
const MAX_PROMPT = 20_000

/**
 * Types a prompt into a pane running Claude Code or Codex, as a bracketed
 * paste so newlines stay in the prompt, then presses Enter. The pause lets
 * the agent finish taking the paste, or it reads the Enter as part of it.
 */
function sendPrompt(paneId: string, prompt: string): boolean {
  const status = agents.status(paneId)
  const text = prompt.trim()
  if (!status?.agent || status.status === 'exited' || !text || text.length > MAX_PROMPT) {
    return false
  }
  // An ESC in the text could end the paste early, so none go through.
  ptys.write(paneId, `\x1b[200~${text.replaceAll('\x1b', '')}\x1b[201~`)
  setTimeout(() => ptys.write(paneId, '\r'), 150)
  return true
}

/** Asks the chrome to open a new agent session that starts with `prompt`. */
function openSession(prompt: string): boolean {
  const text = prompt.trim()
  if (!mainWindow || !text || text.length > MAX_PROMPT) return false
  mainWindow.webContents.send(IPC.sessionsOpen, { prompt: text })
  return true
}

/** Tell the monitor which pane the user is looking at, so a finished turn counts as seen. */
function updateFocus(): void {
  const win = mainWindow
  // Kids mode covers the panes; a turn that ends meanwhile is still news later.
  if (!win?.isFocused() || kidsActive) {
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

function currentTheme(): ResolvedTheme {
  const c = config.get()
  return resolveTheme(
    themes.list(),
    c.appearance.theme,
    c.appearance.overrides,
    c.terminal.fontFamily
  )
}

/** The window's own background shows while the chrome loads and around resizes. */
function windowBackground(): string {
  const bg = currentTheme().tokens.bg
  return /^#[0-9a-f]{3,8}$/i.test(bg) ? bg : '#1e1f24'
}

/** Only a built-in layout the user has changed can go back to how it was. */
function canResetLayout(): boolean {
  const a = config.get().appearance
  return BUILT_IN_LAYOUTS.some((l) => l.id === a.layout) && a.layout in a.layouts
}

/** The chrome owns the appearance; menu choices go to it to apply and save. */
function sendAppearance(command: AppearanceCommand): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  win.webContents.send(IPC.appearanceCommand, command)
}

/** Kids mode gets a menu with nothing in it to quit, hide, or close with. */
function applyMenu(): void {
  Menu.setApplicationMenu(
    kidsActive
      ? buildKidsMenu({ onAbout: showAbout })
      : buildMenu({
          onAbout: showAbout,
          onKidsMode: () => setKids(true),
          themes: themes.list(),
          theme: currentTheme().id,
          onTheme: (id) => sendAppearance({ type: 'theme', id }),
          layouts: layoutChoices(config.get().appearance),
          layout: config.get().appearance.layout,
          onLayout: (id) => sendAppearance({ type: 'layout', id }),
          onResetLayout: () => sendAppearance({ type: 'resetLayout' }),
          canResetLayout: canResetLayout(),
          onTogglePanels: () => sendAppearance({ type: 'togglePanels' }),
          onOpenFolder: () => void shell.openPath(cockpitHome())
        })
  )
}

/** The appearance or the theme files changed: follow them outside the chrome. */
function appearanceChanged(): void {
  applyMenu()
  const win = mainWindow
  if (win && !win.isDestroyed()) win.setBackgroundColor(windowBackground())
}

/**
 * macOS's standard About panel shows the app bundle's icon, which is
 * Electron's while Cockpit runs unpackaged.
 */
function showAbout(): void {
  const options = {
    icon: nativeImage.createFromPath(iconPath),
    message: 'Cockpit',
    detail: `Version ${app.getVersion()}\nElectron ${process.versions.electron}`,
    buttons: ['OK']
  }
  const win = mainWindow
  void (win && !win.isDestroyed()
    ? dialog.showMessageBox(win, options)
    : dialog.showMessageBox(options))
}

function setKids(active: boolean): void {
  if (active === kidsActive) return
  kidsActive = active
  const win = mainWindow
  // Kiosk mode on macOS also turns off Cmd+Tab, force quit, and hiding.
  if (win && !win.isDestroyed()) win.setKiosk(active)
  applyMenu()
  updateFocus()
  win?.webContents.send(IPC.kidsChanged, active)
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
    backgroundColor: windowBackground(),
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // Web panes. will-attach-webview below decides what each one gets.
      webviewTag: true
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
      system.set(false)
      lastSessions = ''
      layoutShown = false
    }
  })
  win.on('close', () => {
    captureCwds()
    // While the window still exists, so kiosk mode is turned off on it.
    setKids(false)
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
    layoutShown = false
    ptys.killAllFor(wc)
    widgets.detach(wc)
    system.set(false)
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
    const launch = agents.launch(preset.command, {
      resume: opts.resume === true,
      prompt: opts.prompt
    })
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
  // Kids mode covers the panes. If a key gets past it anyway, it stops here.
  ipcMain.on(IPC.ptyWrite, (e, id: string, data: string) => {
    if (trusted(e) && !kidsActive) ptys.write(id, data)
  })
  ipcMain.on(IPC.ptyResize, (e, id: string, cols: number, rows: number) => {
    if (trusted(e)) ptys.resize(id, cols, rows)
  })
  ipcMain.on(IPC.ptyKill, (e, id: string) => {
    if (trusted(e) && !kidsActive) ptys.kill(id)
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
  ipcMain.on(IPC.appearanceSave, (e, appearance: AppearanceSettings) => {
    if (!trusted(e)) return
    config.setAppearance(appearance)
    appearanceChanged()
  })
  ipcMain.handle(IPC.themesList, (e) => {
    if (!trusted(e)) throw new Error('untrusted sender')
    return themes.list()
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
    const cwd = await paneCwd(paneId)
    return cwd ? gitStatus(cwd) : null
  })
  ipcMain.handle(IPC.sessionsSend, (e, paneId: unknown, prompt: unknown) => {
    if (!trusted(e) || typeof paneId !== 'string' || typeof prompt !== 'string') return false
    return sendPrompt(paneId, prompt)
  })
  ipcMain.handle(IPC.prsList, async (e, paneId: unknown): Promise<PrList> => {
    if (!trusted(e) || typeof paneId !== 'string') return { ok: false, error: 'No pane' }
    const cwd = await paneCwd(paneId)
    return cwd ? listPrs(cwd) : { ok: false, error: 'No pane' }
  })
  ipcMain.on(IPC.openGitHub, (e, url: unknown) => {
    if (trusted(e) && typeof url === 'string' && url.startsWith('https://github.com/')) {
      void shell.openExternal(url)
    }
  })
  ipcMain.on(IPC.openWeb, (e, url: unknown) => {
    if (trusted(e) && typeof url === 'string' && canOpenExternally(url)) {
      void shell.openExternal(url)
    }
  })
  ipcMain.handle(IPC.commandsList, async (e, paneId: unknown) => {
    if (!trusted(e)) throw new Error('untrusted sender')
    return listCommands(typeof paneId === 'string' ? await paneCwd(paneId) : null)
  })
  ipcMain.handle(
    IPC.commandsSave,
    async (e, paneId: unknown, req: unknown): Promise<SaveResult> => {
      if (!trusted(e) || typeof req !== 'object' || req === null) {
        return { ok: false, error: 'untrusted sender' }
      }
      const r = req as Record<string, unknown>
      if (typeof r.name !== 'string' || typeof r.body !== 'string') {
        return { ok: false, error: 'A command needs a name and a prompt' }
      }
      const cwd = typeof paneId === 'string' ? await paneCwd(paneId) : null
      return saveCommand({
        name: r.name,
        scope: r.scope === 'repo' ? 'repo' : 'global',
        body: r.body,
        description: typeof r.description === 'string' ? r.description : undefined,
        overwrite: r.overwrite === true,
        cwd: cwd ?? app.getPath('home')
      })
    }
  )
  ipcMain.handle(IPC.commandsDelete, async (e, paneId: unknown, name: unknown, scope: unknown) => {
    if (!trusted(e) || typeof name !== 'string') return false
    const cwd = typeof paneId === 'string' ? await paneCwd(paneId) : null
    return deleteCommand(cwd, name, scope === 'repo' ? 'repo' : 'global')
  })
  ipcMain.handle(IPC.menuPopup, (e, items: unknown) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!trusted(e) || !win || !Array.isArray(items)) return null
    return new Promise<string | null>((resolve) => {
      let chosen: string | null = null
      Menu.buildFromTemplate(menuTemplate(items, (id) => (chosen = id))).popup({
        window: win,
        callback: () => resolve(chosen)
      })
    })
  })
  ipcMain.on(IPC.systemWatch, (e, on: unknown) => {
    if (trusted(e)) system.set(on === true)
  })
  ipcMain.on(IPC.launcherSave, (e, launcher: LauncherSettings) => {
    if (trusted(e)) config.setLauncher(launcher)
  })
  ipcMain.handle(IPC.kidsGet, (e) => trusted(e) && kidsActive)
  ipcMain.on(IPC.kidsSet, (e, active: unknown) => {
    if (trusted(e) && typeof active === 'boolean') setKids(active)
  })
  ipcMain.handle(IPC.kidsCharacters, async (e): Promise<KidsCharacter[]> => {
    if (!trusted(e)) throw new Error('untrusted sender')
    return listCharacters(join(cockpitHome(), 'kids'))
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

/**
 * A web pane is a <webview> in the chrome. Whatever the chrome asked for, it
 * gets no preload and no Node, runs sandboxed, and browses in its own
 * partition: the default session's dead proxy and permission rules are the
 * chrome's, and its cookies stay apart from everything else.
 */
function hardenWebPane(prefs: WebPreferences, params: Record<string, string>): void {
  delete prefs.preload
  prefs.nodeIntegration = false
  prefs.nodeIntegrationInSubFrames = false
  prefs.contextIsolation = true
  prefs.sandbox = true
  prefs.webSecurity = true
  prefs.allowRunningInsecureContent = false
  params.partition = WEB_PARTITION
  delete params.allowpopups
}

/** Keep a web pane on web pages, and send popups and shortcuts where they belong. */
function guardWebPane(contents: WebContents): void {
  // New windows go to the browser, like links in the terminals.
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  const stay = (ev: { url: string; preventDefault: () => void }): void => {
    if (!isWebUrl(ev.url)) ev.preventDefault()
  }
  contents.on('will-navigate', stay)
  contents.on('will-redirect', stay)
  contents.on('will-frame-navigate', stay)
  // The page has the keyboard, so the chrome never sees its shortcuts. Pass
  // Cmd chords on, as WidgetHost does for widgets.
  contents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown' || !input.meta) return
    mainWindow?.webContents.send(IPC.appKey, {
      code: input.code,
      metaKey: input.meta,
      ctrlKey: input.control,
      altKey: input.alt,
      shiftKey: input.shift
    })
  })
}

/** Everything that needs the app to be ready. */
async function startup(): Promise<void> {
  // Unpackaged, the Dock shows Electron's icon until this runs.
  app.dock?.setIcon(iconPath)
  // Chrome needs no browser permissions; widgets get theirs through the broker.
  app.on('web-contents-created', (_e, contents) => {
    contents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
    contents.on('will-attach-webview', (ev, prefs, params) => {
      if (contents !== mainWindow?.webContents || !isWebUrl(params.src ?? '')) {
        ev.preventDefault()
        return
      }
      hardenWebPane(prefs, params)
    })
    if (contents.getType() === 'webview') guardWebPane(contents)
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
    appearanceChanged()
  })
  config.watch()

  themes = new ThemeStore(join(cockpitHome(), 'themes'), (list) => {
    mainWindow?.webContents.send(IPC.themesChanged, list)
    appearanceChanged()
  })
  themes.start()
  const imagesDir = join(cockpitHome(), 'images')
  images = new TreeWatcher(imagesDir, () => {
    imagesRevision++
    mainWindow?.webContents.send(IPC.imagesChanged, imagesRevision)
  })
  images.start()
  serveAssets({
    theme: (id) => themes.root(id),
    images: () => {
      try {
        return realpathSync(imagesDir)
      } catch {
        return null
      }
    }
  })

  widgets = new WidgetHost({
    home: cockpitHome(),
    trusted,
    theme: () => currentTheme().tokens,
    sessions: () => sessions().map(widgetSession),
    startSession: openSession,
    sendPrompt
  })
  widgets.start()

  agents = new AgentMonitor({
    home: cockpitHome(),
    onChange: sessionsChanged,
    onActivity: (update) => mainWindow?.webContents.send(IPC.activityUpdate, update),
    // No notifications over kids mode; the tab badges have them afterwards.
    windowFocused: () => kidsActive || (mainWindow?.isFocused() ?? false),
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

  applyMenu()
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
  const parts = [config, themes, images, system, widgets, agents] as (
    { close: () => void } | undefined
  )[]
  for (const part of parts) part?.close()
})
