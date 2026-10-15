import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import { IPC, type PtyCreateOptions } from '@shared/ipc'
import { PtyManager } from './pty'
import { buildMenu } from './menu'

const ptys = new PtyManager()
let mainWindow: BrowserWindow | null = null

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
  win.on('closed', () => {
    ptys.killAllFor(wc)
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
  ipcMain.handle(IPC.ptyCreate, (e, opts: PtyCreateOptions) => {
    if (!trusted(e)) throw new Error('untrusted sender')
    return ptys.create(e.sender, opts)
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
  ipcMain.handle(IPC.clipboardRead, (e) => (trusted(e) ? clipboard.readText() : ''))
  ipcMain.on(IPC.clipboardWrite, (e, text: string) => {
    if (trusted(e) && typeof text === 'string') void clipboard.writeText(text)
  })
}

void app.whenReady().then(() => {
  // Chrome needs no browser permissions; widgets get theirs through the broker.
  app.on('web-contents-created', (_e, contents) => {
    contents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
    contents.on('will-attach-webview', (ev) => ev.preventDefault())
  })

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

app.on('before-quit', () => ptys.killAll())
