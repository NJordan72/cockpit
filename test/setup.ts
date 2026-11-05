// Loaded before every test file (bunfig.toml). Outside Electron, the electron
// package exports only the path to its binary, so this stands in for the
// parts of its API that main process modules import.
import { mock } from 'bun:test'

void mock.module('electron', () => ({
  app: {},
  contextBridge: {},
  ipcRenderer: {},
  Menu: {},
  Notification: { isSupported: () => false },
  protocol: {},
  safeStorage: {},
  shell: {}
}))
