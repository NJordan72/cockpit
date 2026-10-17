import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { CockpitConfig } from '@shared/config'
import {
  IPC,
  type AppKey,
  type CockpitApi,
  type PaneSession,
  type PtyCreateOptions,
  type PtyExitInfo
} from '@shared/ipc'
import type { SecretPrompt, WidgetEventTopic, WidgetInfo } from '@shared/widgets'

// One IPC listener per channel, fanned out by PTY id, so panes don't each add
// a listener to ipcRenderer.
const dataSubs = new Map<string, Set<(data: string) => void>>()
const exitSubs = new Map<string, Set<(info: PtyExitInfo) => void>>()

ipcRenderer.on(IPC.ptyData, (_e: IpcRendererEvent, id: string, data: string) => {
  dataSubs.get(id)?.forEach((cb) => cb(data))
})
ipcRenderer.on(IPC.ptyExit, (_e: IpcRendererEvent, id: string, info: PtyExitInfo) => {
  exitSubs.get(id)?.forEach((cb) => cb(info))
})

const configSubs = new Set<(config: CockpitConfig) => void>()
ipcRenderer.on(IPC.configChanged, (_e: IpcRendererEvent, config: CockpitConfig) => {
  configSubs.forEach((cb) => cb(config))
})

type Subscribe<A extends unknown[]> = (cb: (...args: A) => void) => () => void

/**
 * One IPC listener per channel, fanned out to any number of callbacks. The
 * payload types are whatever main sends on that channel (see CockpitApi).
 */
function channel(name: string): Subscribe<never[]> {
  const subs = new Set<(...args: never[]) => void>()
  ipcRenderer.on(name, (_e: IpcRendererEvent, ...args: unknown[]) => {
    subs.forEach((cb) => cb(...(args as never[])))
  })
  return (cb) => {
    subs.add(cb)
    return () => subs.delete(cb)
  }
}

const onWidgetsChanged: Subscribe<[WidgetInfo[]]> = channel(IPC.widgetsChanged)
const onWidgetEvent: Subscribe<[string, WidgetEventTopic, unknown]> = channel(IPC.widgetEvent)
const onSecretPrompt: Subscribe<[SecretPrompt]> = channel(IPC.secretPrompt)
const onAppKey: Subscribe<[AppKey]> = channel(IPC.appKey)
const onSessionsChanged: Subscribe<[PaneSession[]]> = channel(IPC.sessionsChanged)
const onPaneFocus: Subscribe<[string]> = channel(IPC.paneFocus)

function subscribe<T>(map: Map<string, Set<T>>, id: string, cb: T): () => void {
  let set = map.get(id)
  if (!set) map.set(id, (set = new Set()))
  set.add(cb)
  return () => {
    set.delete(cb)
    if (set.size === 0) map.delete(id)
  }
}

const api: CockpitApi = {
  pty: {
    create: (opts: PtyCreateOptions) => ipcRenderer.invoke(IPC.ptyCreate, opts),
    write: (id, data) => ipcRenderer.send(IPC.ptyWrite, id, data),
    resize: (id, cols, rows) => ipcRenderer.send(IPC.ptyResize, id, cols, rows),
    kill: (id) => ipcRenderer.send(IPC.ptyKill, id),
    cwd: (id) => ipcRenderer.invoke(IPC.ptyCwd, id),
    onData: (id, cb) => subscribe(dataSubs, id, cb),
    onExit: (id, cb) => subscribe(exitSubs, id, cb)
  },
  clipboard: {
    readText: () => ipcRenderer.invoke(IPC.clipboardRead),
    writeText: (text) => ipcRenderer.send(IPC.clipboardWrite, text)
  },
  config: {
    get: () => ipcRenderer.invoke(IPC.configGet),
    onChange: (cb) => {
      configSubs.add(cb)
      return () => configSubs.delete(cb)
    },
    saveLayout: (layout) => ipcRenderer.send(IPC.layoutSave, layout),
    saveSidebar: (sidebar) => ipcRenderer.send(IPC.sidebarSave, sidebar)
  },
  dirs: {
    list: () => ipcRenderer.invoke(IPC.dirsList)
  },
  widgets: {
    list: () => ipcRenderer.invoke(IPC.widgetsList),
    onChange: (cb) => onWidgetsChanged(cb),
    call: (widgetId, method, params) =>
      ipcRenderer.invoke(IPC.widgetCall, widgetId, method, params),
    onEvent: (cb) => onWidgetEvent(cb),
    onSecretPrompt: (cb) => onSecretPrompt(cb),
    answerSecret: (promptId, value) => ipcRenderer.send(IPC.secretAnswer, promptId, value)
  },
  sessions: {
    list: () => ipcRenderer.invoke(IPC.sessionsList),
    onChange: (cb) => onSessionsChanged(cb),
    onFocusRequest: (cb) => onPaneFocus(cb)
  },
  onAppKey: (cb) => onAppKey(cb)
}

contextBridge.exposeInMainWorld('cockpit', api)
