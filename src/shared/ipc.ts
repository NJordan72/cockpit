// IPC channel names and payload types shared by main, preload, and renderer.
import type { ActivityUpdate, GitStatus, PaneActivity } from './activity'
import type { CockpitConfig, LauncherSettings, Layout, SidebarSettings } from './config'
import type {
  SecretPrompt,
  SessionInfo,
  WidgetCallResult,
  WidgetEventTopic,
  WidgetInfo,
  WidgetMethod
} from './widgets'

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
  sidebarSave: 'sidebar:save',
  launcherSave: 'launcher:save',
  dirsList: 'dirs:list',
  widgetsList: 'widgets:list',
  widgetsChanged: 'widgets:changed',
  widgetCall: 'widget:call',
  widgetEvent: 'widget:event',
  secretPrompt: 'secret:prompt',
  secretAnswer: 'secret:answer',
  sessionsList: 'sessions:list',
  sessionsChanged: 'sessions:changed',
  paneFocus: 'pane:focus',
  activityGet: 'activity:get',
  activityUpdate: 'activity:update',
  activityGit: 'activity:git',
  appKey: 'app:key'
} as const

/**
 * A session as the chrome sees it. Widgets get SessionInfo without
 * `message`, which can quote a command waiting for approval.
 */
export interface PaneSession extends SessionInfo {
  /** What the agent is waiting for, while status is needs-input. */
  message: string | null
}

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
  /**
   * When a Cockpit pane, Claude Code, or Codex last ran here (ms since the
   * epoch), or 0 if never.
   */
  usedMs: number
  /** The preset that ran then, if one matches. */
  usedPresetId: string | null
}

export interface DirListing {
  /** Recent dirs and the projects dir's subdirectories, most recently used first. */
  dirs: DirEntry[]
}

/** A key press forwarded from the main process (matches KeyboardEvent's fields). */
export interface AppKey {
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
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
    saveSidebar(sidebar: SidebarSettings): void
    saveLauncher(launcher: LauncherSettings): void
  }
  dirs: {
    list(): Promise<DirListing>
  }
  widgets: {
    list(): Promise<WidgetInfo[]>
    onChange(cb: (widgets: WidgetInfo[]) => void): () => void
    /** Run a widget's API call. The caller must have identified the widget. */
    call(widgetId: string, method: WidgetMethod, params: unknown): Promise<WidgetCallResult>
    onEvent(cb: (widgetId: string, topic: WidgetEventTopic, data: unknown) => void): () => void
    onSecretPrompt(cb: (prompt: SecretPrompt) => void): () => void
    /** null when the user cancelled. */
    answerSecret(promptId: string, value: string | null): void
  }
  sessions: {
    /** One entry per pane, with its status. */
    list(): Promise<PaneSession[]>
    onChange(cb: (sessions: PaneSession[]) => void): () => void
    /** The user clicked a notification about this pane. */
    onFocusRequest(cb: (paneId: string) => void): () => void
  }
  activity: {
    /** Everything kept about a pane's activity so far. */
    get(paneId: string): Promise<PaneActivity>
    /** What changed since; sent for every pane. */
    onUpdate(cb: (update: ActivityUpdate) => void): () => void
    /** The pane's repository, or null when its directory isn't in one. */
    git(paneId: string): Promise<GitStatus | null>
  }
  /** App shortcuts pressed while a widget had keyboard focus. */
  onAppKey(cb: (key: AppKey) => void): () => void
}
