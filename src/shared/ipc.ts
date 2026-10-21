// IPC channel names and payload types shared by main, preload, and renderer.
import type { ActivityUpdate, GitStatus, PaneActivity } from './activity'
import type { CommandList, CommandScope, SaveCommand, SaveResult } from './commands'
import type { AppearanceSettings, CockpitConfig, LauncherSettings, Layout } from './config'
import type { PrList } from './prs'
import type { ThemeDefinition } from './theme'
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
  launcherSave: 'launcher:save',
  appearanceSave: 'appearance:save',
  appearanceCommand: 'appearance:command',
  themesList: 'themes:list',
  themesChanged: 'themes:changed',
  imagesChanged: 'images:changed',
  systemWatch: 'system:watch',
  systemSample: 'system:sample',
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
  sessionsSend: 'sessions:send',
  sessionsOpen: 'sessions:open',
  prsList: 'prs:list',
  commandsList: 'commands:list',
  commandsSave: 'commands:save',
  commandsDelete: 'commands:delete',
  menuPopup: 'menu:popup',
  openGitHub: 'open:github',
  appKey: 'app:key',
  kidsGet: 'kids:get',
  kidsSet: 'kids:set',
  kidsChanged: 'kids:changed',
  kidsCharacters: 'kids:characters'
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
  /** Open the agent's session picker instead of a new session. */
  resume?: boolean
  /** The agent's first prompt, for a new session. */
  prompt?: string
}

/** A widget asks for a new agent session that starts with a prompt. */
export interface OpenSessionRequest {
  prompt: string
}

/** A native context menu. The chosen item's id comes back, or null. */
export type MenuItem =
  | { id: string; label: string; enabled?: boolean }
  | { type: 'separator' }
  | { label: string; submenu: MenuItem[] }

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

/** A picture from ~/.cockpit/kids/, for kids mode. */
export interface KidsCharacter {
  /** From the file name: "Peppa Pig.png" is "Peppa Pig". */
  name: string
  /** The letter key that shows it (the name's first letter), or null. */
  letter: string | null
  /** A data: URL. */
  src: string
}

/** A View menu choice, carried out by the chrome, which owns the appearance. */
export type AppearanceCommand =
  | { type: 'theme'; id: string }
  | { type: 'layout'; id: string }
  | { type: 'resetLayout' }
  | { type: 'togglePanels' }

/** A reading for the System panel. */
export interface SystemSample {
  /** Share of all cores' time spent busy since the last reading, 0 to 1. */
  cpu: number
  cores: number
  /** 1, 5, and 15 minute load averages. */
  load: [number, number, number]
  /** Bytes, counted as Activity Monitor's "Memory Used". */
  memUsed: number
  memTotal: number
  /** Seconds since boot. */
  uptime: number
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
    saveLauncher(launcher: LauncherSettings): void
    saveAppearance(appearance: AppearanceSettings): void
    /** The View menu asks for a change. */
    onAppearanceCommand(cb: (command: AppearanceCommand) => void): () => void
  }
  themes: {
    /** Built-in themes, then the ones in ~/.cockpit/themes/. */
    list(): Promise<ThemeDefinition[]>
    onChange(cb: (themes: ThemeDefinition[]) => void): () => void
  }
  images: {
    /** Something in ~/.cockpit/images/ changed; the number goes up each time. */
    onChange(cb: (revision: number) => void): () => void
  }
  system: {
    /** Take readings while a System panel is visible. */
    watch(on: boolean): void
    onSample(cb: (sample: SystemSample) => void): () => void
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
    /** Type a prompt into an agent pane and submit it. False if it isn't running one. */
    send(paneId: string, prompt: string): Promise<boolean>
    /** A widget asked for a new session. */
    onOpenRequest(cb: (req: OpenSessionRequest) => void): () => void
  }
  prs: {
    /** Open pull requests for the pane's repository, through gh. */
    list(paneId: string): Promise<PrList>
    /** Opens a https://github.com/ URL in the browser. */
    open(url: string): void
  }
  commands: {
    /** Saved commands for the pane's repository and everywhere. */
    list(paneId: string | null): Promise<CommandList>
    /** Saves a command; a repo command goes in the pane's repository. */
    save(paneId: string | null, req: Omit<SaveCommand, 'cwd'>): Promise<SaveResult>
    delete(paneId: string | null, name: string, scope: CommandScope): Promise<boolean>
  }
  /** Shows a native context menu at the pointer. */
  menu(items: MenuItem[]): Promise<string | null>
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
  kids: {
    /** Whether kids mode is on. It stays on if the chrome reloads. */
    active(): Promise<boolean>
    set(active: boolean): void
    onChange(cb: (active: boolean) => void): () => void
    /** The pictures in ~/.cockpit/kids/, read again on each call. */
    characters(): Promise<KidsCharacter[]>
  }
}
