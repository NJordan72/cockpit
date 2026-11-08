// IPC channel names and payload types shared by main, preload, and renderer.
import type { ActivityUpdate, GitStatus, PaneActivity } from './activity'
import type { CommandList, CommandScope, SaveCommand, SaveResult } from './commands'
import type {
  Action,
  AppearanceSettings,
  CockpitConfig,
  LauncherSettings,
  Layout,
  RecentPage,
  WindowView
} from './config'
import type { PrList } from './prs'
import type { NewTask, NewTaskResult, TaskDraft, TaskInfo } from './tasks'
import type { ThemeDefinition } from './theme'
import type {
  PaneLabel,
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
  ptyAck: 'pty:ack',
  clipboardRead: 'clipboard:read',
  clipboardWrite: 'clipboard:write',
  configGet: 'config:get',
  configChanged: 'config:changed',
  layoutSave: 'layout:save',
  launcherSave: 'launcher:save',
  appearanceSave: 'appearance:save',
  appearanceCommand: 'appearance:command',
  appearanceChanged: 'appearance:changed',
  windowInfo: 'window:info',
  windowSave: 'window:save',
  windowChanged: 'window:changed',
  windowCount: 'window:count',
  windowForward: 'window:forward',
  appAction: 'app:action',
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
  secretDone: 'secret:done',
  widgetStarted: 'widget:started',
  widgetLabelOpen: 'widget:label-open',
  sessionsList: 'sessions:list',
  sessionsChanged: 'sessions:changed',
  paneFocus: 'pane:focus',
  sessionsReveal: 'sessions:reveal',
  activityGet: 'activity:get',
  activityUpdate: 'activity:update',
  activityGit: 'activity:git',
  sessionsSend: 'sessions:send',
  sessionsOpen: 'sessions:open',
  prsList: 'prs:list',
  tasksList: 'tasks:list',
  tasksChanged: 'tasks:changed',
  tasksRefresh: 'tasks:refresh',
  tasksCreate: 'tasks:create',
  tasksRemove: 'tasks:remove',
  tasksCleanUp: 'tasks:cleanup',
  tasksOpen: 'tasks:open',
  tasksDraft: 'tasks:draft',
  panesClose: 'panes:close',
  commandsList: 'commands:list',
  commandsSave: 'commands:save',
  commandsDelete: 'commands:delete',
  menuPopup: 'menu:popup',
  openGitHub: 'open:github',
  openWeb: 'open:web',
  webRecent: 'web:recent',
  filesExisting: 'files:existing',
  filesOpen: 'files:open',
  editorFile: 'editor:file',
  editorProject: 'editor:project',
  appKey: 'app:key',
  kidsGet: 'kids:get',
  kidsSet: 'kids:set',
  kidsChanged: 'kids:changed',
  kidsCharacters: 'kids:characters'
} as const

/**
 * A session as the chrome sees it. Widgets get SessionInfo without
 * `message`, which can quote a command waiting for approval, and without
 * `labels`.
 */
export interface PaneSession extends SessionInfo {
  /** What the agent is waiting for, while status is needs-input. */
  message: string | null
  /** What widgets show in a strip above the pane, ordered by widget id. */
  labels: PaneLabel[]
}

export interface PtyCreateOptions {
  id: string
  cols: number
  rows: number
  /** Which preset to run. The main process looks up its command. */
  presetId: string
  /** Working directory; falls back to the preset's, then home. */
  cwd?: string
  /** Fail instead of falling back when `cwd` isn't a directory. */
  strictCwd?: boolean
  /** Open the agent's session picker instead of a new session. */
  resume?: boolean
  /** The agent's first prompt, for a new session. */
  prompt?: string
}

/** A widget asks for a new agent session that starts with a prompt. */
export interface OpenSessionRequest {
  prompt: string
}

/** A tab to open in a task's worktree, asked for by a window of panels. */
export interface TaskOpenRequest {
  /** The worktree, with ~ for home. */
  path: string
  /** The preset to run; the start screen's agent when missing. */
  presetId?: string
}

/** A native context menu. The chosen item's id comes back, or null. */
export type MenuItem =
  | { id: string; label: string; enabled?: boolean; checked?: boolean }
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

/**
 * A terminal acknowledges output in steps of this many characters once it
 * has parsed it, so main can pause a PTY whose terminal is falling behind.
 */
export const PTY_ACK_CHARS = 5000

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

/** What a window's chrome needs to know about itself and the other windows. */
export interface WindowInfo {
  /** Its WindowState id in config.json. */
  id: string
  /** The widgets this window shows; each runs in one window only (see widgetHomes). */
  widgets: string[]
  /** How many windows are open, and how many displays there are to put them on. */
  count: number
  displays: number
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
    /** The terminal is done with `chars` more characters of output (see PTY_ACK_CHARS). */
    ack(id: string, chars: number): void
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
    /** Another window changed the appearance every window shares. */
    onAppearanceChange(cb: (appearance: AppearanceSettings) => void): () => void
  }
  window: {
    info(): Promise<WindowInfo>
    /** Main has new widgets or a new window count for this window. */
    onChange(cb: (info: WindowInfo) => void): () => void
    /** This window's own layout and Cmd+B state. */
    save(view: WindowView): void
    /** Open or close windows until there are `count`, and put them on the displays. */
    setCount(count: number): void
    /** Run a pane action in the window with the terminals the user last worked in. */
    forward(action: Action): void
    /** Another window forwarded an action here. */
    onAction(cb: (action: Action) => void): () => void
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
    /** A prompt was answered, maybe in another window. */
    onSecretDone(cb: (promptId: string) => void): () => void
    /** A widget's page has started (again); main drops what its last one left. */
    started(widgetId: string): void
    /** Opens the URL of a widget's label on a pane, if the widget may still open it. */
    openLabel(paneId: string, widgetId: string): void
  }
  sessions: {
    /** One entry per pane, with its status. */
    list(): Promise<PaneSession[]>
    onChange(cb: (sessions: PaneSession[]) => void): () => void
    /** The user clicked a notification about this pane, or another window asked. */
    onFocusRequest(cb: (paneId: string) => void): () => void
    /** Bring forward the window a pane is in, and focus the pane. */
    reveal(paneId: string): void
    /** Type a prompt into an agent pane and submit it. False if it isn't running one. */
    send(paneId: string, prompt: string): Promise<boolean>
    /** A widget asked for a new session. */
    onOpenRequest(cb: (req: OpenSessionRequest) => void): () => void
    /** Main closes these panes, in whichever window they're in: their task is being removed. */
    onCloseRequest(cb: (paneIds: string[]) => void): () => void
  }
  tasks: {
    /** The worktrees Cockpit made, newest first, as last read. */
    list(): Promise<TaskInfo[]>
    onChange(cb: (tasks: TaskInfo[]) => void): () => void
    /** Read the worktrees again, and the pull requests not read lately, or all of them with `force`. */
    refresh(force?: boolean): void
    /** Makes the worktree, or finds the one the branch has. */
    create(req: NewTask): Promise<NewTaskResult>
    /**
     * Removes a task's worktree, asking first when that would lose work or
     * close terminals. True once it's gone.
     */
    remove(path: string): Promise<boolean>
    /** Removes every task whose pull request merged with nothing newer, after asking. How many went. */
    cleanUp(): Promise<number>
    /** Opens a tab in a task in the window with terminals the user last worked in. */
    open(req: TaskOpenRequest): void
    /** Another window asked this one to open a tab in a task. */
    onOpen(cb: (req: TaskOpenRequest) => void): () => void
    /** A widget asked for the New task dialog, filled in. */
    onDraft(cb: (draft: TaskDraft) => void): () => void
  }
  prs: {
    /** Open pull requests for the pane's repository, through gh. */
    list(paneId: string): Promise<PrList>
    /** Opens a https://github.com/ URL in the browser. */
    open(url: string): void
  }
  files: {
    /** Which of these paths exist, relative to the pane's directory. */
    existing(paneId: string, paths: string[]): Promise<string[]>
    /** Opens a path from the pane's terminal in its default app. */
    open(paneId: string, path: string): void
  }
  editor: {
    /** Opens an absolute path in config.json's editor. */
    openFile(path: string): void
    /** Opens the pane's repository, or its directory outside one, in config.json's editor. */
    openProject(paneId: string): void
  }
  commands: {
    /** Saved commands for the pane's repository and everywhere. */
    list(paneId: string | null): Promise<CommandList>
    /** Saves a command; a repo command goes in the pane's repository. */
    save(paneId: string | null, req: Omit<SaveCommand, 'cwd'>): Promise<SaveResult>
    delete(paneId: string | null, name: string, scope: CommandScope): Promise<boolean>
  }
  web: {
    /** Opens a web pane's page in the default browser. */
    openExternal(url: string): void
    /** Pages most recently loaded in web panes, newest first. */
    recent(): Promise<RecentPage[]>
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
  /** App shortcuts pressed while a widget or a web pane had keyboard focus. */
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
