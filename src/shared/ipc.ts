// IPC channel names and payload types shared by main, preload, and renderer.

export const IPC = {
  ptyCreate: 'pty:create',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  clipboardRead: 'clipboard:read',
  clipboardWrite: 'clipboard:write'
} as const

export interface PtyCreateOptions {
  id: string
  cols: number
  rows: number
  /** Command to run inside the login shell. Omit for an interactive shell. */
  command?: string
  cwd?: string
}

export interface PtyExitInfo {
  exitCode: number
  signal?: number
}

export interface CockpitApi {
  pty: {
    create(opts: PtyCreateOptions): Promise<{ pid: number }>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    kill(id: string): void
    onData(id: string, cb: (data: string) => void): () => void
    onExit(id: string, cb: (info: PtyExitInfo) => void): () => void
  }
  clipboard: {
    readText(): Promise<string>
    writeText(text: string): void
  }
}
