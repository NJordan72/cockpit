// IPC channel names and payload types shared by main, preload, and renderer.
import type { CockpitConfig, Layout } from './config'

export const IPC = {
  ptyCreate: 'pty:create',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyCwd: 'pty:cwd',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  clipboardRead: 'clipboard:read',
  clipboardWrite: 'clipboard:write',
  configGet: 'config:get',
  configChanged: 'config:changed',
  layoutSave: 'layout:save',
  dirsList: 'dirs:list'
} as const

export interface PtyCreateOptions {
  id: string
  cols: number
  rows: number
  /** Which preset to run. The main process looks up its command. */
  presetId: string
  /** Working directory; falls back to the preset's, then home. */
  cwd?: string
}

export interface PtyCreated {
  pid: number
  /** The directory it actually started in, with ~ for home. */
  cwd: string
}

export interface PtyExitInfo {
  exitCode: number
  signal?: number
}

export interface DirEntry {
  /** Path with ~ for home. */
  path: string
  name: string
  mtimeMs: number
}

export interface DirListing {
  recent: string[]
  projects: DirEntry[]
}

export interface CockpitApi {
  pty: {
    create(opts: PtyCreateOptions): Promise<PtyCreated>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    kill(id: string): void
    /** Current working directory of the pane's process, with ~ for home. */
    cwd(id: string): Promise<string | null>
    onData(id: string, cb: (data: string) => void): () => void
    onExit(id: string, cb: (info: PtyExitInfo) => void): () => void
  }
  clipboard: {
    readText(): Promise<string>
    writeText(text: string): void
  }
  config: {
    get(): Promise<CockpitConfig>
    onChange(cb: (config: CockpitConfig) => void): () => void
    saveLayout(layout: Layout): void
  }
  dirs: {
    list(): Promise<DirListing>
  }
}
