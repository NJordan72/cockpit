import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { ActivityUpdate } from '@shared/activity'
import type { CockpitConfig } from '@shared/config'
import {
  IPC,
  type AppearanceCommand,
  type AppKey,
  type OpenSessionRequest,
  type CockpitApi,
  type PaneSession,
  type PtyCreateOptions,
  type PtyExitInfo,
  type SystemSample
} from '@shared/ipc'
import type { ThemeDefinition } from '@shared/theme'
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
const onOpenSession: Subscribe<[OpenSessionRequest]> = channel(IPC.sessionsOpen)
const onActivityUpdate: Subscribe<[ActivityUpdate]> = channel(IPC.activityUpdate)
const onKidsChanged: Subscribe<[boolean]> = channel(IPC.kidsChanged)
const onAppearanceCommand: Subscribe<[AppearanceCommand]> = channel(IPC.appearanceCommand)
const onThemesChanged: Subscribe<[ThemeDefinition[]]> = channel(IPC.themesChanged)
const onImagesChanged: Subscribe<[number]> = channel(IPC.imagesChanged)
const onSystemSample: Subscribe<[SystemSample]> = channel(IPC.systemSample)

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
    saveLauncher: (launcher) => ipcRenderer.send(IPC.launcherSave, launcher),
    saveAppearance: (appearance) => ipcRenderer.send(IPC.appearanceSave, appearance),
    onAppearanceCommand
  },
  themes: {
    list: () => ipcRenderer.invoke(IPC.themesList),
    onChange: onThemesChanged
  },
  images: {
    onChange: onImagesChanged
  },
  system: {
    watch: (on) => ipcRenderer.send(IPC.systemWatch, on),
    onSample: onSystemSample
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
    onFocusRequest: (cb) => onPaneFocus(cb),
    send: (paneId, prompt) => ipcRenderer.invoke(IPC.sessionsSend, paneId, prompt),
    onOpenRequest: (cb) => onOpenSession(cb)
  },
  prs: {
    list: (paneId) => ipcRenderer.invoke(IPC.prsList, paneId),
    open: (url) => ipcRenderer.send(IPC.openGitHub, url)
  },
  files: {
    existing: (paneId, paths) => ipcRenderer.invoke(IPC.filesExisting, paneId, paths),
    open: (paneId, path) => ipcRenderer.send(IPC.filesOpen, paneId, path)
  },
  commands: {
    list: (paneId) => ipcRenderer.invoke(IPC.commandsList, paneId),
    save: (paneId, req) => ipcRenderer.invoke(IPC.commandsSave, paneId, req),
    delete: (paneId, name, scope) => ipcRenderer.invoke(IPC.commandsDelete, paneId, name, scope)
  },
  menu: (items) => ipcRenderer.invoke(IPC.menuPopup, items),
  activity: {
    get: (paneId) => ipcRenderer.invoke(IPC.activityGet, paneId),
    onUpdate: (cb) => onActivityUpdate(cb),
    git: (paneId) => ipcRenderer.invoke(IPC.activityGit, paneId)
  },
  onAppKey: (cb) => onAppKey(cb),
  kids: {
    active: () => ipcRenderer.invoke(IPC.kidsGet),
    set: (active) => ipcRenderer.send(IPC.kidsSet, active),
    onChange: (cb) => onKidsChanged(cb),
    characters: () => ipcRenderer.invoke(IPC.kidsCharacters)
  }
}

contextBridge.exposeInMainWorld('cockpit', api)
