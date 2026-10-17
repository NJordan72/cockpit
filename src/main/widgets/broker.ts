// Runs widget API calls. The caller says which widget is calling (the chrome
// works that out from the message's source window); everything else in the
// call is untrusted and checked here against that widget's manifest.
import {
  WIDGET_METHODS,
  type SessionInfo,
  type WidgetCallResult,
  type WidgetMethod
} from '@shared/widgets'
import { toWidgetError, WidgetCallError } from './errors'
import { brokerFetch } from './fetch'
import { urlAllowed } from './permissions'
import type { LoadedWidget } from './registry'
import { MAX_SECRET_LENGTH, type SecretStore } from './secrets'
import type { WidgetStorage } from './storage'

export interface BrokerDeps {
  widget: (id: string) => LoadedWidget | undefined
  storage: WidgetStorage
  secrets: SecretStore
  /** Ask the user for a secret in the host's own UI. null if they cancel. */
  promptSecret: (widget: LoadedWidget, name: string) => Promise<string | null>
  sessions: () => SessionInfo[]
  openExternal: (url: string) => Promise<void>
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

      case 'openExternal': {
        const raw = str(params, 'url')
        let url: URL
        try {
          url = new URL(raw)
        } catch {
          throw new WidgetCallError('invalid_argument', `not an absolute URL: ${raw}`)
        }
        if (!urlAllowed(url, parsed.openExternal)) {
          const listed = permissions.openExternal.length
            ? `it lists: ${permissions.openExternal.join(', ')}`
            : 'it lists none'
          throw denied(
            `opening ${url.origin}${url.pathname} is not allowed by permissions.openExternal (${listed})`
          )
        }
        // The parsed form, so the browser gets exactly the URL that was checked.
        await this.deps.openExternal(url.href)
        return null
      }

      case 'sessions.list':
        if (permissions.sessions !== 'read') {
          throw denied('sessions are not allowed: set "permissions.sessions": "read"')
        }
        return this.deps.sessions()
    }
  }
}
