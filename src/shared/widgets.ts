// Types shared by the widget broker (main), the widget host (renderer), and
// the SDK that runs inside widgets.

export const WIDGET_SCHEME = 'cockpit-widget'
/** Served by the host inside every widget's origin; widget files can't override it. */
export const SDK_PATH = '/cockpit-widget.js'

export interface WidgetPermissions {
  /** Hosts cockpit.fetch may reach: "api.example.com", "*.example.com", "http://localhost:3000". */
  network: string[]
  /** URL patterns cockpit.openExternal may open: "https://app.example.com/*". */
  openExternal: string[]
  /** Secret names this widget may read and write. */
  secrets: string[]
  storage: boolean
  sessions: 'read' | null
}

export interface WidgetManifest {
  id: string
  name: string
  version: string
  description: string | null
  /** HTML file to load, relative to the widget folder. */
  entry: string
  /** fill: share the sidebar's height. content: as tall as the widget's document. */
  sizing: 'fill' | 'content'
  permissions: WidgetPermissions
}

export interface WidgetInfo {
  /** Folder name under ~/.cockpit/widgets; the manifest id must match it. */
  id: string
  /** Folder path with ~ for home (after following symlinks). */
  dir: string
  /** Bumped whenever a file in the folder changes; the host reloads on change. */
  revision: number
  manifest: WidgetManifest | null
  /** Why the widget couldn't be loaded. Set exactly when manifest is null. */
  error: string | null
}

export type WidgetErrorCode =
  | 'permission_denied'
  | 'invalid_argument'
  | 'not_found'
  | 'timeout'
  | 'network_error'
  | 'too_large'
  | 'cancelled'
  | 'unavailable'
  | 'internal'

export interface WidgetError {
  code: WidgetErrorCode
  message: string
}

export type WidgetCallResult = { ok: true; value: unknown } | { ok: false; error: WidgetError }

export interface FetchInit {
  method?: string
  headers?: Record<string, string> | [string, string][]
  body?: string
  /** Default 30 s, at most 120 s. */
  timeoutMs?: number
}

export interface FetchResult {
  ok: boolean
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  /** Final URL after redirects. */
  url: string
  redirected: boolean
}

/** Until agent awareness lands, a live pane is 'running'. */
export type SessionStatus = 'running' | 'idle' | 'working' | 'needs-input' | 'done' | 'exited'

export interface SessionInfo {
  /** Pane id. */
  id: string
  tabId: string
  presetId: string
  /** Preset name, e.g. "Claude Code". */
  name: string
  /** Working directory with ~ for home. */
  cwd: string
  status: SessionStatus
  /** The focused pane of the active tab. */
  focused: boolean
}

/** Methods a widget can call, with their parameters. */
export interface WidgetMethods {
  fetch: { url: string; init?: FetchInit }
  'storage.get': { key: string }
  'storage.set': { key: string; value: unknown }
  'storage.keys': Record<string, never>
  'secrets.get': { name: string; prompt?: boolean }
  'secrets.set': { name: string; value: string }
  'secrets.delete': { name: string }
  openExternal: { url: string }
  'sessions.list': Record<string, never>
}

export type WidgetMethod = keyof WidgetMethods

export const WIDGET_METHODS: readonly WidgetMethod[] = [
  'fetch',
  'storage.get',
  'storage.set',
  'storage.keys',
  'secrets.get',
  'secrets.set',
  'secrets.delete',
  'openExternal',
  'sessions.list'
]

/** Events the host pushes into a widget. */
export interface WidgetEvents {
  storage: { key: string; value: unknown }
  sessions: SessionInfo[]
  theme: Record<string, string>
  visibility: { visible: boolean }
}

export type WidgetEventTopic = keyof WidgetEvents

/** What the SDK learns from the host when it starts. */
export interface WidgetInit {
  widget: { id: string; name: string; version: string; sizing: WidgetManifest['sizing'] }
  permissions: WidgetPermissions
  theme: Record<string, string>
  visible: boolean
}

// postMessage protocol between the SDK (in the widget iframe) and the host
// (the chrome renderer). Every message carries `cockpit: 1`.

export type WidgetToHost =
  | { cockpit: 1; type: 'hello' }
  | { cockpit: 1; type: 'call'; id: number; method: WidgetMethod; params: unknown }
  | { cockpit: 1; type: 'size'; height: number }

export type HostToWidget =
  | { cockpit: 1; type: 'init'; init: WidgetInit }
  | { cockpit: 1; type: 'result'; id: number; result: WidgetCallResult }
  | { cockpit: 1; type: 'event'; topic: WidgetEventTopic; data: unknown }

/** A host-rendered prompt asking the user for a secret a widget needs. */
export interface SecretPrompt {
  promptId: string
  widgetId: string
  widgetName: string
  name: string
}
