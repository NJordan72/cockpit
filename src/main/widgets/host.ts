// Main-process side of widgets: serves widget files over
// cockpit-widget://, answers widget API calls from the chrome, asks the user
// for secrets, keeps the labels widgets put on sessions, and pushes storage
// and session changes to the chrome, which forwards them into the right
// iframe.
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  ipcMain,
  protocol,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents
} from 'electron'
import sdkSource from 'virtual:cockpit-widget-sdk'
import { IPC } from '@shared/ipc'
import type { Theme } from '@shared/theme'
import { themeVars } from '@shared/theme'
import {
  SDK_PATH,
  WIDGET_SCHEME,
  type SecretPrompt,
  type SessionInfo,
  type WidgetEventTopic,
  type WidgetEvents
} from '@shared/widgets'
import { openableUrl, WidgetBroker, type WidgetRunDeps } from './broker'
import { SessionLabels } from './labels'
import { sessionsAllow } from './manifest'
import { WidgetRegistry, type LoadedWidget } from './registry'
import { SecretStore } from './secrets'
import { contentType, injectIntoHtml, injection, resolveWidgetFile, widgetHeaders } from './serve'
import { WidgetStorage } from './storage'

const PROMPT_COOLDOWN_MS = 10_000

export interface WidgetHostOptions {
  home: string
  theme: () => Theme
  sessions: () => SessionInfo[]
  startSession: (prompt: string) => boolean
  startTask: (draft: { branch: string; prompt: string }) => boolean
  sendPrompt: (paneId: string, prompt: string) => boolean
  runs: WidgetRunDeps
  /** A label on a session changed; the chrome's session list carries them. */
  labelsChanged: () => void
  /** Only accept IPC from the chrome's own top-level frame. */
  trusted: (e: IpcMainEvent | IpcMainInvokeEvent) => boolean
  /** Widgets were installed, removed, or edited. */
  changed?: () => void
}

export class WidgetHost {
  readonly registry: WidgetRegistry
  readonly labels = new SessionLabels()
  private readonly storage: WidgetStorage
  private readonly secrets: SecretStore
  private readonly broker: WidgetBroker
  /**
   * The windows' chromes. Each widget runs in one of them; events go to all,
   * and a chrome passes on only those for widgets it shows.
   */
  private targets = new Set<WebContents>()
  private guarded = new WeakSet<WebContents>()
  private prompts = new Map<string, { widgetId: string; resolve: (v: string | null) => void }>()
  private openPrompts = new Map<string, Promise<string | null>>()
  /** When the user last dismissed a prompt from each widget. */
  private dismissedAt = new Map<string, number>()
  private lastSessions = ''

  constructor(private readonly opts: WidgetHostOptions) {
    this.registry = new WidgetRegistry(path.join(opts.home, 'widgets'), (list) => {
      this.send(IPC.widgetsChanged, list)
      // A widget that's gone, broken, or no longer allowed to label takes its labels with it.
      const labelers = list.filter((w) =>
        sessionsAllow(w.manifest?.permissions.sessions ?? null, 'label')
      )
      if (this.labels.retainWidgets(new Set(labelers.map((w) => w.id)))) opts.labelsChanged()
      opts.changed?.()
    })
    this.storage = new WidgetStorage(path.join(opts.home, 'data'), (id, key, value) => {
      if (this.registry.get(id)?.parsed?.manifest.permissions.storage) {
        this.sendEvent(id, 'storage', { key, value })
      }
    })
    this.secrets = new SecretStore(path.join(opts.home, 'secrets'))
    this.broker = new WidgetBroker({
      widget: (id) => this.registry.get(id),
      storage: this.storage,
      secrets: this.secrets,
      promptSecret: (w, name) => this.promptSecret(w, name),
      sessions: opts.sessions,
      startSession: opts.startSession,
      startTask: opts.startTask,
      sendPrompt: opts.sendPrompt,
      setLabel: (widgetId, paneId, label) => {
        if (this.labels.set(paneId, widgetId, label)) opts.labelsChanged()
      },
      openExternal: (url) => shell.openExternal(url),
      runs: opts.runs
    })
  }

  /** Call once the app is ready. */
  start(): void {
    protocol.handle(WIDGET_SCHEME, (req) => this.serve(req))
    this.registry.start()
    this.storage.watch()
    this.registerIpc()
  }

  close(): void {
    this.registry.close()
    this.storage.close()
  }

  /** Add a window's chrome to the ones that show widgets, and guard its widget frames. */
  attach(wc: WebContents): void {
    this.targets.add(wc)
    // A reload attaches again; the guards are already in place.
    if (this.guarded.has(wc)) return
    this.guarded.add(wc)
    // A widget can navigate its own frame, and a URL can carry data out. The
    // chrome only ever frames widgets, so cancel every other frame load.
    // (will-frame-navigate would be the natural hook, but Electron 44 doesn't
    // emit it for these out-of-process frames.) Non-network targets need no
    // rule: Chromium doesn't commit a widget's data: navigation, the sandbox
    // refuses external protocols like mailto:, and another widget's page would
    // still run with this frame's identity and permissions.
    wc.session.webRequest.onBeforeRequest(
      { urls: ['<all_urls>'], types: ['subFrame'] },
      (details, callback) => {
        callback({ cancel: !details.url.startsWith(`${WIDGET_SCHEME}://`) })
      }
    )
    // A widget with keyboard focus would swallow the app's shortcuts. Pass
    // Cmd chords on to the chrome, which runs them if they're bound.
    wc.on('before-input-event', (_e, input) => {
      if (input.type !== 'keyDown' || !input.meta) return
      if (!wc.focusedFrame?.parent) return
      wc.send(IPC.appKey, {
        code: input.code,
        metaKey: input.meta,
        ctrlKey: input.control,
        altKey: input.alt,
        shiftKey: input.shift
      })
    })
    // CSP doesn't cover WebRTC; keep it from talking to arbitrary hosts.
    wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
  }

  /**
   * A window's chrome went away or reloaded. Prompts wait for another window,
   * unless none is left to answer them. A reload attaches again.
   */
  detach(wc: WebContents): void {
    if (!this.targets.delete(wc) || this.targets.size > 0) return
    for (const [promptId, { resolve }] of this.prompts) {
      resolve(null)
      this.send(IPC.secretDone, promptId)
    }
    this.prompts.clear()
    this.lastSessions = ''
  }

  /** Recompute sessions and push them to widgets that may read them, if changed. */
  sessionsChanged(): void {
    const list = this.opts.sessions()
    // A pane that closed takes its labels with it.
    this.labels.retainPanes(new Set(list.map((s) => s.id)))
    const json = JSON.stringify(list)
    if (json === this.lastSessions) return
    this.lastSessions = json
    for (const info of this.registry.list()) {
      if (info.manifest?.permissions.sessions) this.sendEvent(info.id, 'sessions', list)
    }
  }

  private registerIpc(): void {
    const { trusted } = this.opts
    ipcMain.handle(IPC.widgetsList, (e) => {
      if (!trusted(e)) throw new Error('untrusted sender')
      return this.registry.list()
    })
    ipcMain.handle(IPC.widgetCall, (e, widgetId: unknown, method: unknown, params: unknown) => {
      if (!trusted(e)) throw new Error('untrusted sender')
      if (typeof widgetId !== 'string') throw new Error('widget id must be a string')
      return this.broker.call(widgetId, method, params)
    })
    ipcMain.on(IPC.secretAnswer, (e, promptId: unknown, value: unknown) => {
      if (!trusted(e) || typeof promptId !== 'string') return
      const pending = this.prompts.get(promptId)
      if (!pending) return
      this.prompts.delete(promptId)
      const answer = typeof value === 'string' && value !== '' ? value : null
      if (answer === null) this.dismissedAt.set(pending.widgetId, Date.now())
      pending.resolve(answer)
      // Every window was told about the prompt; the others drop it now.
      this.send(IPC.secretDone, promptId)
    })
    // A widget's page loaded: the first time, or after a reload, a change to
    // its files, or a move to another window. Hiding it doesn't unload it.
    ipcMain.on(IPC.widgetStarted, (e, widgetId: unknown) => {
      if (!trusted(e) || typeof widgetId !== 'string') return
      if (this.labels.dropWidget(widgetId)) this.opts.labelsChanged()
    })
    ipcMain.on(IPC.widgetLabelOpen, (e, paneId: unknown, widgetId: unknown) => {
      if (!trusted(e) || typeof paneId !== 'string' || typeof widgetId !== 'string') return
      const url = this.labels.get(paneId, widgetId)?.url
      const parsed = this.registry.get(widgetId)?.parsed
      if (!url || !parsed) return
      // Checked again: the widget's manifest may have changed since it set the label.
      let allowed: string
      try {
        allowed = openableUrl(url, parsed)
      } catch {
        return
      }
      shell.openExternal(allowed).catch((err: unknown) => {
        console.warn(`could not open ${allowed}:`, err)
      })
    })
  }

  private promptSecret(widget: LoadedWidget, name: string): Promise<string | null> {
    const manifest = widget.parsed?.manifest
    if (this.targets.size === 0 || !manifest) return Promise.resolve(null)
    // A widget that asks again right after the user said no is refused for a
    // while, so a widget asking in a loop can't keep the window covered.
    if (Date.now() - (this.dismissedAt.get(manifest.id) ?? 0) < PROMPT_COOLDOWN_MS) {
      return Promise.resolve(null)
    }
    // Several calls waiting for the same secret share one prompt.
    const key = `${manifest.id}/${name}`
    const open = this.openPrompts.get(key)
    if (open) return open
    const prompt: SecretPrompt = {
      promptId: randomUUID(),
      widgetId: manifest.id,
      widgetName: manifest.name,
      name
    }
    const answer = new Promise<string | null>((resolve) => {
      this.prompts.set(prompt.promptId, { widgetId: manifest.id, resolve })
    }).finally(() => this.openPrompts.delete(key))
    this.openPrompts.set(key, answer)
    // The window showing the widget asks; the others keep it in case the
    // widget moves to them.
    this.send(IPC.secretPrompt, prompt)
    return answer
  }

  private async serve(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const id = url.hostname
    const headers = widgetHeaders(id)
    const text = (status: number, body: string): Response =>
      new Response(body, { status, headers: { ...headers, 'content-type': 'text/plain' } })

    if (req.method !== 'GET' && req.method !== 'HEAD') return text(405, 'method not allowed')
    const widget = this.registry.get(id)
    if (!widget?.parsed || !widget.root) return text(404, `no widget "${id}" is loaded`)
    if (url.pathname === SDK_PATH) {
      return new Response(sdkSource, {
        headers: { ...headers, 'content-type': 'text/javascript; charset=utf-8' }
      })
    }

    const pathname = url.pathname === '/' ? `/${widget.parsed.manifest.entry}` : url.pathname
    const file = resolveWidgetFile(widget.root, pathname)
    if (!file) return text(404, 'not found')
    let body: Buffer
    try {
      // A symlink inside the folder must not lead out of it.
      if (!(await fs.realpath(file)).startsWith(widget.root + path.sep)) throw new Error('outside')
      body = await fs.readFile(file)
    } catch {
      return text(404, `not found: ${pathname}`)
    }
    const type = contentType(file)
    if (type.startsWith('text/html')) {
      const snippet = injection(themeVars(this.opts.theme()))
      body = Buffer.from(injectIntoHtml(body.toString('utf8'), snippet))
    }
    return new Response(new Uint8Array(body), { headers: { ...headers, 'content-type': type } })
  }

  private send(channel: string, ...args: unknown[]): void {
    for (const wc of this.targets) if (!wc.isDestroyed()) wc.send(channel, ...args)
  }

  private sendEvent<T extends WidgetEventTopic>(id: string, topic: T, data: WidgetEvents[T]): void {
    this.send(IPC.widgetEvent, id, topic, data)
  }
}
