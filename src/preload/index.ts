import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { CockpitConfig } from '@shared/config'
import { IPC, type CockpitApi, type PtyCreateOptions, type PtyExitInfo } from '@shared/ipc'

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
    saveLayout: (layout) => ipcRenderer.send(IPC.layoutSave, layout)
  },
  dirs: {
    list: () => ipcRenderer.invoke(IPC.dirsList)
  }
}

contextBridge.exposeInMainWorld('cockpit', api)
