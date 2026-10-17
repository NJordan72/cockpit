// cockpit.fetch: an HTTP request made from the main process on a widget's
// behalf, so CORS doesn't apply, but only to hosts the widget's manifest
// lists. Redirects are followed by hand so every hop is checked too.
import type { FetchInit, FetchResult } from '@shared/widgets'
import { WidgetCallError } from './errors'
import { hostAllowed, type HostPattern } from './permissions'

export interface FetchPolicy {
  patterns: readonly HostPattern[]
  /** The manifest's entries, for error messages. */
  listed: readonly string[]
}

export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024
const MAX_REDIRECTS = 5
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 120_000
const REDIRECTS = new Set([301, 302, 303, 307, 308])
const FORBIDDEN_METHODS = new Set(['CONNECT', 'TRACE', 'TRACK'])

function checkUrl(raw: string, policy: FetchPolicy, what: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new WidgetCallError('invalid_argument', `${what}: not an absolute URL: ${raw}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new WidgetCallError('permission_denied', `${what}: only http(s) URLs are allowed`)
  }
  if (url.username || url.password) {
    throw new WidgetCallError('permission_denied', `${what}: URLs with credentials are refused`)
  }
  if (!hostAllowed(url, policy.patterns)) {
    const entry = url.protocol === 'http:' ? `http://${url.host}` : url.host
    const listed = policy.listed.length
      ? `it lists: ${policy.listed.join(', ')}`
      : 'it lists no hosts'
    throw new WidgetCallError(
      'permission_denied',
      `${what} to ${url.protocol}//${url.host} is not allowed. Add "${entry}" to permissions.network in widget.json (${listed}).`
    )
  }
  return url
}

function readHeaders(raw: FetchInit['headers']): Headers {
  try {
    return new Headers(raw ?? {})
  } catch (err) {
    throw new WidgetCallError('invalid_argument', `fetch: bad headers: ${(err as Error).message}`)
  }
}

async function readBody(res: Response): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = (await reader.read()) as { done: boolean; value?: Uint8Array }
    if (done || !value) break
    size += value.byteLength
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new WidgetCallError(
        'too_large',
        `fetch: response is larger than ${MAX_RESPONSE_BYTES / 1024 / 1024} MB`
      )
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

function networkError(err: unknown, url: URL, signal: AbortSignal, timeoutMs: number): Error {
  if (err instanceof WidgetCallError) return err
  if (signal.aborted) {
    return new WidgetCallError(
      'timeout',
      `fetch: ${url.host} did not answer within ${timeoutMs} ms`
    )
  }
  // undici reports "fetch failed" and puts the reason (ENOTFOUND, ECONNREFUSED ...) in cause.
  const cause = (err as { cause?: { code?: string; message?: string } }).cause
  const reason = cause?.code ?? cause?.message ?? (err as Error).message
  return new WidgetCallError('network_error', `fetch: ${url.host}: ${reason}`)
}

export async function brokerFetch(
  rawUrl: unknown,
  init: FetchInit | undefined,
  policy: FetchPolicy
): Promise<FetchResult> {
  if (typeof rawUrl !== 'string')
    throw new WidgetCallError('invalid_argument', 'fetch: url must be a string')
  let url = checkUrl(rawUrl, policy, 'fetch')

  const rawMethod: unknown = init?.method ?? 'GET'
  if (typeof rawMethod !== 'string') {
    throw new WidgetCallError('invalid_argument', 'fetch: method must be a string')
  }
  let method = rawMethod.toUpperCase()
  if (!/^[A-Z]+$/.test(method) || FORBIDDEN_METHODS.has(method)) {
    throw new WidgetCallError('invalid_argument', `fetch: method ${method} is not allowed`)
  }
  let body = init?.body
  if (body !== undefined && typeof body !== 'string') {
    throw new WidgetCallError('invalid_argument', 'fetch: body must be a string')
  }
  if (body !== undefined && (method === 'GET' || method === 'HEAD')) {
    throw new WidgetCallError('invalid_argument', `fetch: a ${method} request can't have a body`)
  }
  const headers = readHeaders(init?.headers)
  const timeoutMs =
    typeof init?.timeoutMs === 'number' && Number.isFinite(init.timeoutMs)
      ? Math.min(MAX_TIMEOUT_MS, Math.max(1, init.timeoutMs))
      : DEFAULT_TIMEOUT_MS
  const signal = AbortSignal.timeout(timeoutMs)

  let redirected = false
  for (let hop = 0; ; hop++) {
    let res: Response
    try {
      res = await fetch(url, { method, headers, body, redirect: 'manual', signal })
    } catch (err) {
      throw networkError(err, url, signal, timeoutMs)
    }
    const location = res.headers.get('location')
    if (REDIRECTS.has(res.status) && location) {
      await res.body?.cancel()
      if (hop >= MAX_REDIRECTS) {
        throw new WidgetCallError('network_error', `fetch: more than ${MAX_REDIRECTS} redirects`)
      }
      let next: URL
      try {
        next = new URL(location, url)
      } catch {
        throw new WidgetCallError('network_error', `fetch: ${url.host} redirected to a bad URL`)
      }
      url = checkUrl(next.href, policy, 'fetch: redirect')
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
        if (method !== 'HEAD') method = 'GET'
        body = undefined
        headers.delete('content-type')
      }
      redirected = true
      continue
    }
    let text: string
    try {
      text = await readBody(res)
    } catch (err) {
      throw networkError(err, url, signal, timeoutMs)
    }
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      headers: Object.fromEntries(res.headers.entries()),
      body: text,
      url: url.href,
      redirected
    }
  }
}
