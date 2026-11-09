// Runs widget API calls. The caller says which widget is calling (the chrome
// works that out from the message's source window); everything else in the
// call is untrusted and checked here against that widget's manifest.
import {
  WIDGET_METHODS,
  type PaneLabel,
  type SessionInfo,
  type WidgetCallResult,
  type WidgetMethod
} from '@shared/widgets'
import { toWidgetError, WidgetCallError } from './errors'
import { brokerFetch } from './fetch'
import { parseLabel } from './labels'
import { sessionsAllow, type ParsedManifest } from './manifest'
import { urlAllowed } from './permissions'
import type { LoadedWidget } from './registry'
import { MAX_SECRET_LENGTH, type SecretStore } from './secrets'
import type { WidgetStorage } from './storage'
import { MAX_BRANCH } from '@shared/tasks'
import { checkGraph, MAX_GRAPH_BYTES, type WidgetRun } from '@shared/runs'

/** Longest prompt a widget may fill the New task dialog with, as for sessions.send. */
const MAX_PROMPT = 20_000

export interface BrokerDeps {
  widget: (id: string) => LoadedWidget | undefined
  storage: WidgetStorage
  secrets: SecretStore
  /** Ask the user for a secret in the host's own UI. null if they cancel. */
  promptSecret: (widget: LoadedWidget, name: string) => Promise<string | null>
  sessions: () => SessionInfo[]
  /** Open a new agent session that starts with the prompt. False if it couldn't. */
  startSession: (prompt: string) => boolean
  /** Show the New task dialog with the branch and prompt filled in. False if it couldn't. */
  startTask: (draft: { branch: string; prompt: string }) => boolean
  /** Type a prompt into an agent pane. False if the pane runs no agent. */
  sendPrompt: (paneId: string, prompt: string) => boolean
  /** Set a widget's label on a pane, or remove it with null. */
  setLabel: (widgetId: string, paneId: string, label: PaneLabel | null) => void
  openExternal: (url: string) => Promise<void>
  runs: WidgetRunDeps
}

/** What a widget can do with runs. Each call names the widget, which sees only its own runs. */
export interface WidgetRunDeps {
  /** Asks the user to confirm the run. Fails only when no window can ask. */
  submit: (
    widgetId: string,
    widgetName: string,
    graph: unknown
  ) => { ok: true; id: string } | { ok: false; error: string }
  markDone: (
    widgetId: string,
    runId: string,
    itemId: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>
  list: (widgetId: string) => WidgetRun[]
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

const denied = (message: string): WidgetCallError =>
  new WidgetCallError('permission_denied', message)

function str(params: Obj, key: string): string {
  const v = params[key]
  if (typeof v !== 'string')
    throw new WidgetCallError('invalid_argument', `"${key}" must be a string`)
  return v
}

/**
 * The URL as the browser would get it, if the widget's openExternal patterns
 * allow it. Throws otherwise.
 */
export function openableUrl(raw: string, parsed: ParsedManifest): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new WidgetCallError('invalid_argument', `not an absolute URL: ${raw}`)
  }
  if (!urlAllowed(url, parsed.openExternal)) {
    const listed = parsed.manifest.permissions.openExternal
    throw denied(
      `opening ${url.origin}${url.pathname} is not allowed by permissions.openExternal (${
        listed.length ? `it lists: ${listed.join(', ')}` : 'it lists none'
      })`
    )
  }
  return url.href
}

export class WidgetBroker {
  constructor(private readonly deps: BrokerDeps) {}

  async call(widgetId: string, method: unknown, params: unknown): Promise<WidgetCallResult> {
    try {
      const widget = this.deps.widget(widgetId)
      if (!widget?.parsed)
        throw new WidgetCallError('not_found', `no widget "${widgetId}" is loaded`)
      if (typeof method !== 'string' || !(WIDGET_METHODS as readonly string[]).includes(method)) {
        throw new WidgetCallError('invalid_argument', `unknown method ${JSON.stringify(method)}`)
      }
      const value = await this.run(widget, method as WidgetMethod, isObj(params) ? params : {})
      return { ok: true, value }
    } catch (err) {
      return { ok: false, error: toWidgetError(err) }
    }
  }

  private async run(widget: LoadedWidget, method: WidgetMethod, params: Obj): Promise<unknown> {
    const parsed = widget.parsed
    if (!parsed) throw new WidgetCallError('not_found', 'widget is not loaded')
    const { permissions } = parsed.manifest
    const id = widget.info.id

    const requireStorage = (): void => {
      if (!permissions.storage)
        throw denied('storage is not allowed: set "permissions.storage": true')
    }
    const secretName = (): string => {
      const name = str(params, 'name')
      if (!permissions.secrets.includes(name)) {
        throw denied(
          `secret "${name}" is not declared: add it to permissions.secrets in widget.json`
        )
      }
      return name
    }

    switch (method) {
      case 'fetch': {
        if (params.init !== undefined && !isObj(params.init)) {
          throw new WidgetCallError('invalid_argument', 'fetch init must be an object')
        }
        return brokerFetch(params.url, params.init, {
          patterns: parsed.network,
          listed: permissions.network
        })
      }

      case 'storage.get':
        requireStorage()
        return this.deps.storage.get(id, params.key)
      case 'storage.set':
        requireStorage()
        this.deps.storage.set(id, params.key, params.value)
        return null
      case 'storage.keys':
        requireStorage()
        return this.deps.storage.keys(id)

      case 'secrets.get': {
        const name = secretName()
        const stored = await this.deps.secrets.get(id, name)
        if (stored !== null || params.prompt === false) return stored
        const entered = await this.deps.promptSecret(widget, name)
        if (entered === null) {
          throw new WidgetCallError('cancelled', `the prompt for secret "${name}" was dismissed`)
        }
        await this.deps.secrets.set(id, name, entered)
        return entered
      }
      case 'secrets.set': {
        const name = secretName()
        const value = str(params, 'value')
        if (value === '' || value.length > MAX_SECRET_LENGTH) {
          throw new WidgetCallError(
            'invalid_argument',
            'secret value must be 1 to 65536 characters'
          )
        }
        await this.deps.secrets.set(id, name, value)
        return null
      }
      case 'secrets.delete':
        await this.deps.secrets.delete(id, secretName())
        return null

      case 'openExternal':
        // The parsed form, so the browser gets exactly the URL that was checked.
        await this.deps.openExternal(openableUrl(str(params, 'url'), parsed))
        return null

      case 'sessions.list':
        if (!permissions.sessions) {
          throw denied('sessions are not allowed: set "permissions.sessions": "read"')
        }
        return this.deps.sessions()

      case 'sessions.label': {
        if (!sessionsAllow(permissions.sessions, 'label')) {
          throw denied('labeling sessions is not allowed: set "permissions.sessions": "label"')
        }
        const paneId = str(params, 'id')
        if (params.label === null) {
          // A session that just closed has no label left to remove.
          this.deps.setLabel(id, paneId, null)
          return null
        }
        const content = parseLabel(params.label, (url) => openableUrl(url, parsed))
        if (!this.deps.sessions().some((s) => s.id === paneId)) {
          throw new WidgetCallError('not_found', `no session "${paneId}"`)
        }
        this.deps.setLabel(id, paneId, {
          widgetId: id,
          widgetName: parsed.manifest.name,
          ...content
        })
        return null
      }

      case 'sessions.startTask': {
        if (permissions.sessions !== 'prompt') {
          throw denied('starting tasks is not allowed: set "permissions.sessions": "prompt"')
        }
        const branch = str(params, 'branch').trim()
        const prompt = str(params, 'prompt').trim()
        if (branch.length > MAX_BRANCH || prompt.length > MAX_PROMPT) {
          throw new WidgetCallError('invalid_argument', 'the branch or the prompt is too long')
        }
        if (!this.deps.startTask({ branch, prompt })) {
          throw new WidgetCallError('unavailable', 'no window can show the New task dialog')
        }
        return null
      }

      case 'runs.submit':
      case 'runs.markDone':
      case 'runs.list': {
        // A run gets no permission of its own: nothing in it starts until
        // the user has seen every item and prompt in Cockpit's dialog.
        if (permissions.sessions !== 'prompt') {
          throw denied('runs are not allowed: set "permissions.sessions": "prompt"')
        }
        if (method === 'runs.list') return this.deps.runs.list(id)
        if (method === 'runs.markDone') {
          const done = await this.deps.runs.markDone(
            id,
            str(params, 'runId'),
            str(params, 'itemId')
          )
          if (!done.ok) throw new WidgetCallError('not_found', done.error)
          return null
        }
        let size: number
        try {
          size = JSON.stringify(params.graph ?? null).length
        } catch {
          throw new WidgetCallError('invalid_argument', 'the run is not JSON')
        }
        if (size > MAX_GRAPH_BYTES) throw new WidgetCallError('too_large', 'the run is over 1 MB')
        const checked = checkGraph(params.graph)
        if (!checked.ok) throw new WidgetCallError('invalid_argument', checked.error)
        const sub = this.deps.runs.submit(id, parsed.manifest.name, params.graph)
        if (!sub.ok) throw new WidgetCallError('unavailable', sub.error)
        return sub.id
      }

      case 'sessions.start':
      case 'sessions.send': {
        if (permissions.sessions !== 'prompt') {
          throw denied('prompting sessions is not allowed: set "permissions.sessions": "prompt"')
        }
        const prompt = str(params, 'prompt')
        const ok =
          method === 'sessions.start'
            ? this.deps.startSession(prompt)
            : this.deps.sendPrompt(str(params, 'id'), prompt)
        if (!ok) {
          throw new WidgetCallError(
            'invalid_argument',
            method === 'sessions.start'
              ? 'could not start a session'
              : 'that session is not running Claude Code, Codex, or Antigravity CLI'
          )
        }
        return null
      }
    }
  }
}
