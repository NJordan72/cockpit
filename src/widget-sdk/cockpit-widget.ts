// The widget side of the broker, served to every widget as
// /cockpit-widget.js and loaded ahead of the widget's own scripts. It defines
// window.cockpit, which turns API calls into postMessage requests to the host
// (the chrome) and turns the host's pushes into subscriptions.
//
// It ships as a classic script, so everything lives inside one function to
// keep its names out of the widget's global scope. Only type imports are
// allowed here: the file is compiled on its own, not bundled.
import type {
  FetchInit,
  FetchResult,
  HostToWidget,
  SessionInfo,
  SessionLabel,
  WidgetCallResult,
  WidgetError,
  WidgetErrorCode,
  WidgetEvents,
  WidgetInit,
  WidgetMethod,
  WidgetMethods,
  WidgetToHost
} from '../shared/widgets'
import type { WidgetRun } from '../shared/runs'

;(() => {
  const host = window.parent
  if (host === window) return

  class CockpitError extends Error {
    readonly code: WidgetErrorCode
    constructor(error: WidgetError) {
      super(error.message)
      this.name = 'CockpitError'
      this.code = error.code
    }
  }

  interface Pending {
    resolve: (value: unknown) => void
    reject: (err: CockpitError) => void
    timer: number | undefined
  }

  const pending = new Map<number, Pending>()
  let nextId = 1

  const post = (msg: WidgetToHost): void => {
    host.postMessage(msg, '*')
  }

  /** timeoutMs null: wait as long as it takes (a prompt the user is answering). */
  function call<M extends WidgetMethod>(
    method: M,
    params: WidgetMethods[M],
    timeoutMs: number | null
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = nextId++
      const timer =
        timeoutMs === null
          ? undefined
          : window.setTimeout(() => {
              pending.delete(id)
              reject(
                new CockpitError({
                  code: 'timeout',
                  message: `${method} got no answer within ${timeoutMs / 1000} s`
                })
              )
            }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      try {
        post({ cockpit: 1, type: 'call', id, method, params })
      } catch (err) {
        // DataCloneError: a value that can't be sent (a function, a DOM node).
        pending.delete(id)
        window.clearTimeout(timer)
        reject(new CockpitError({ code: 'invalid_argument', message: String(err) }))
      }
    })
  }

  type Listener<K extends keyof WidgetEvents> = (data: WidgetEvents[K]) => void
  const listeners: { [K in keyof WidgetEvents]: Set<Listener<K>> } = {
    storage: new Set(),
    sessions: new Set(),
    theme: new Set(),
    visibility: new Set()
  }

  function subscribe<K extends keyof WidgetEvents>(topic: K, cb: Listener<K>): () => void {
    if (typeof cb !== 'function') throw new TypeError('subscribe needs a callback')
    listeners[topic].add(cb)
    return () => {
      listeners[topic].delete(cb)
    }
  }

  function emit<K extends keyof WidgetEvents>(topic: K, data: WidgetEvents[K]): void {
    for (const cb of listeners[topic]) {
      try {
        cb(data)
      } catch (err) {
        console.error(`[cockpit] ${topic} listener threw`, err)
      }
    }
  }

  let info: WidgetInit | null = null
  let theme: Record<string, string> = {}
  let visible = true
  let resolveReady: (init: WidgetInit) => void = () => undefined
  const ready = new Promise<WidgetInit>((resolve) => {
    resolveReady = resolve
  })

  function applyTheme(vars: Record<string, string>): void {
    theme = { ...vars }
    const style = document.documentElement.style
    for (const [name, value] of Object.entries(vars)) style.setProperty(name, value)
  }

  /** sizing "content": tell the host how tall the document is. */
  function reportSize(): void {
    let last = -1
    const measure = (): void => {
      const height = Math.ceil(document.documentElement.getBoundingClientRect().height)
      if (height === last) return
      last = height
      post({ cockpit: 1, type: 'size', height })
    }
    new ResizeObserver(measure).observe(document.documentElement)
    measure()
  }

  const isHostMessage = (v: unknown): v is HostToWidget =>
    typeof v === 'object' && v !== null && (v as { cockpit?: unknown }).cockpit === 1

  window.addEventListener('message', (e: MessageEvent) => {
    // Only the host may talk to us; other widgets can reach this window too.
    if (e.source !== host) return
    const msg: unknown = e.data
    if (!isHostMessage(msg)) return
    switch (msg.type) {
      case 'init':
        if (info) return
        info = msg.init
        applyTheme(info.theme)
        visible = info.visible
        if (info.widget.sizing === 'content') reportSize()
        resolveReady(info)
        return
      case 'result': {
        const p = pending.get(msg.id)
        if (!p) return
        pending.delete(msg.id)
        window.clearTimeout(p.timer)
        const result: WidgetCallResult = msg.result
        if (result.ok) p.resolve(result.value)
        else p.reject(new CockpitError(result.error))
        return
      }
      case 'event':
        switch (msg.topic) {
          case 'theme':
            applyTheme(msg.data as WidgetEvents['theme'])
            emit('theme', { ...theme })
            return
          case 'visibility': {
            const data = msg.data as WidgetEvents['visibility']
            if (data.visible === visible) return
            visible = data.visible
            emit('visibility', data)
            return
          }
          case 'storage':
            emit('storage', msg.data as WidgetEvents['storage'])
            return
          case 'sessions':
            emit('sessions', msg.data as WidgetEvents['sessions'])
            return
        }
    }
  })

  interface CockpitResponse extends FetchResult {
    text(): string
    json(): unknown
  }

  type WidgetFetchInit = Omit<FetchInit, 'headers' | 'body'> & {
    headers?: FetchInit['headers'] | Headers
    body?: string | URLSearchParams
  }

  function fetchInit(init: WidgetFetchInit | undefined): FetchInit | undefined {
    if (!init) return undefined
    const out: FetchInit = {}
    if (init.method !== undefined) out.method = init.method
    if (init.timeoutMs !== undefined) out.timeoutMs = init.timeoutMs
    if (init.headers instanceof Headers) out.headers = [...init.headers.entries()]
    else if (init.headers !== undefined) out.headers = init.headers
    if (init.body instanceof URLSearchParams) {
      out.body = init.body.toString()
      if (!new Headers(out.headers).has('content-type')) {
        out.headers = [
          ...new Headers(out.headers).entries(),
          ['content-type', 'application/x-www-form-urlencoded;charset=UTF-8']
        ]
      }
    } else if (init.body !== undefined) out.body = init.body
    return out
  }

  const cockpit = Object.freeze({
    /** Resolves once the host has said hello (widget info, theme, visibility). */
    ready,
    CockpitError,
    get widget(): WidgetInit['widget'] | null {
      return info?.widget ?? null
    },

    async fetch(url: string | URL, init?: WidgetFetchInit): Promise<CockpitResponse> {
      const res = (await call(
        'fetch',
        { url: String(url), init: fetchInit(init) },
        130_000
      )) as FetchResult
      return {
        ...res,
        text: () => res.body,
        json: () => JSON.parse(res.body) as unknown
      }
    },

    storage: Object.freeze({
      get: (key: string): Promise<unknown> => call('storage.get', { key }, 10_000),
      /** set(key, undefined) removes the key. */
      set: async (key: string, value: unknown): Promise<void> => {
        await call('storage.set', { key, value }, 10_000)
      },
      keys: async (): Promise<string[]> => (await call('storage.keys', {}, 10_000)) as string[],
      subscribe: (cb: Listener<'storage'>) => subscribe('storage', cb)
    }),

    secrets: Object.freeze({
      /**
       * The stored value. If there is none, the host asks the user for it
       * (unless prompt is false, which returns null instead).
       */
      get: async (name: string, opts?: { prompt?: boolean }): Promise<string | null> =>
        (await call('secrets.get', { name, prompt: opts?.prompt !== false }, null)) as
          string | null,
      set: async (name: string, value: string): Promise<void> => {
        await call('secrets.set', { name, value }, 10_000)
      },
      delete: async (name: string): Promise<void> => {
        await call('secrets.delete', { name }, 10_000)
      }
    }),

    async openExternal(url: string | URL): Promise<void> {
      await call('openExternal', { url: String(url) }, 10_000)
    },

    sessions: Object.freeze({
      list: async (): Promise<SessionInfo[]> =>
        (await call('sessions.list', {}, 10_000)) as SessionInfo[],
      subscribe: (cb: Listener<'sessions'>) => subscribe('sessions', cb),
      /** Opens a new agent tab in the focused pane's directory, starting with `prompt`. */
      async start(prompt: string): Promise<void> {
        await call('sessions.start', { prompt }, 10_000)
      },
      /**
       * Shows Cockpit's New task dialog with `prompt` and `branch` filled in.
       * The task's worktree is made, and the agent started, once the user
       * confirms it there.
       */
      async startTask(prompt: string, branch: string): Promise<void> {
        await call('sessions.startTask', { prompt, branch }, 10_000)
      },
      /** Types `prompt` into a session running Claude Code or Codex, and submits it. */
      async send(id: string, prompt: string): Promise<void> {
        await call('sessions.send', { id, prompt }, 10_000)
      },
      /**
       * Shows `label` in a strip above the session's pane, replacing this
       * widget's last one there. null removes it.
       */
      async label(id: string, label: SessionLabel | null): Promise<void> {
        await call('sessions.label', { id, label }, 10_000)
      }
    }),

    runs: Object.freeze({
      /**
       * Hands Cockpit a set of work items and the items each waits on.
       * Cockpit shows the whole run to the user, and starts nothing until
       * they confirm it there. Resolves with the run's id.
       */
      submit: async (graph: unknown): Promise<string> =>
        (await call('runs.submit', { graph }, 10_000)) as string,
      /** Marks an item of a run this widget submitted as done, such as an item outside the run. */
      async markDone(runId: string, itemId: string): Promise<void> {
        await call('runs.markDone', { runId, itemId }, 10_000)
      },
      /** The runs this widget submitted, the ones still waiting for the user included. */
      list: async (): Promise<WidgetRun[]> => (await call('runs.list', {}, 10_000)) as WidgetRun[]
    }),

    theme: Object.freeze({
      /** CSS variables, also set on :root. */
      get vars(): Record<string, string> {
        return { ...theme }
      },
      subscribe: (cb: Listener<'theme'>) => subscribe('theme', cb)
    }),

    visibility: Object.freeze({
      /** False while the widget is collapsed, in a background tab, or the window is hidden. */
      get visible(): boolean {
        return visible
      },
      subscribe: (cb: Listener<'visibility'>) => subscribe('visibility', cb)
    })
  })

  Object.defineProperty(window, 'cockpit', { value: cockpit, enumerable: true })
  post({ cockpit: 1, type: 'hello' })
})()
