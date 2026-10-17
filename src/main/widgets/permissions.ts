// Matchers for the URL-shaped permissions in widget.json: the hosts
// cockpit.fetch may reach and the URLs cockpit.openExternal may open.
// Patterns are parsed once when the manifest loads; a pattern that doesn't
// parse makes the whole manifest invalid rather than being skipped.

type Scheme = 'http' | 'https'

const DEFAULT_PORT: Record<Scheme, number> = { http: 80, https: 443 }

export interface HostPattern {
  scheme: Scheme
  /** Lowercase host without a trailing dot. For "*.example.com", "example.com". */
  host: string
  /** Matches subdomains of host (not host itself). */
  wildcard: boolean
  port: number
}

export interface UrlPattern extends HostPattern {
  /** Matched against pathname + search + hash. */
  path: RegExp
}

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
const HOSTNAME = new RegExp(`^${LABEL}(?:\\.${LABEL})*$`)

/**
 * "api.example.com", "*.example.com", "localhost:8080", "http://127.0.0.1:3000".
 * No scheme means https. No port means the scheme's default.
 */
export function parseHostPattern(raw: string): HostPattern {
  let rest = raw.trim().toLowerCase()
  let scheme: Scheme = 'https'
  const m = /^(https?):\/\//.exec(rest)
  if (m) {
    scheme = m[1] === 'http' ? 'http' : 'https'
    rest = rest.slice(m[0].length)
  }
  if (rest.endsWith('/')) rest = rest.slice(0, -1)
  if (/[/?#@\s]/.test(rest)) throw new Error('must be a host name, without a path')

  let host = rest
  let portText: string | undefined
  const v6 = /^(\[[0-9a-f:.]+\])(?::(\d+))?$/.exec(rest)
  if (v6) {
    host = v6[1] ?? ''
    portText = v6[2]
  } else {
    const colon = rest.lastIndexOf(':')
    if (colon !== -1) {
      host = rest.slice(0, colon)
      portText = rest.slice(colon + 1)
    }
  }

  let port = DEFAULT_PORT[scheme]
  if (portText !== undefined) {
    port = Number(portText)
    if (!/^\d{1,5}$/.test(portText) || port < 1 || port > 65535) {
      throw new Error(`has an invalid port "${portText}"`)
    }
  }

  host = host.replace(/\.$/, '')
  const wildcard = host.startsWith('*.')
  if (wildcard) host = host.slice(2)
  if (!v6 && !HOSTNAME.test(host)) {
    throw new Error(
      host.includes('*')
        ? 'can only use * as a whole leading label, as in *.example.com'
        : 'is not a valid host name'
    )
  }
  if (wildcard && !host.includes('.')) {
    throw new Error('is too broad; *. needs a domain under it, as in *.example.com')
  }
  return { scheme, host, wildcard, port }
}

/** "https://app.example.com/*": scheme and host as above, then a path where * matches anything. */
export function parseUrlPattern(raw: string): UrlPattern {
  const m = /^(https?:\/\/)([^/?#]+)(\/.*)?$/i.exec(raw.trim())
  if (!m) throw new Error('must look like https://host/path')
  const path = m[3]
  if (path === undefined) throw new Error('needs a path; use https://host/* for any page on a host')
  const host = parseHostPattern((m[1] ?? '') + (m[2] ?? ''))
  const re = path
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return { ...host, path: new RegExp(`^${re}$`) }
}

function urlScheme(url: URL): Scheme | null {
  if (url.protocol === 'https:') return 'https'
  if (url.protocol === 'http:') return 'http'
  return null
}

function hostMatches(url: URL, scheme: Scheme, p: HostPattern): boolean {
  if (p.scheme !== scheme) return false
  const port = url.port ? Number(url.port) : DEFAULT_PORT[scheme]
  if (p.port !== port) return false
  const host = url.hostname.replace(/\.$/, '')
  return p.wildcard ? host.endsWith('.' + p.host) : host === p.host
}

export function hostAllowed(url: URL, patterns: readonly HostPattern[]): boolean {
  const scheme = urlScheme(url)
  if (!scheme || url.username || url.password) return false
  return patterns.some((p) => hostMatches(url, scheme, p))
}

export function urlAllowed(url: URL, patterns: readonly UrlPattern[]): boolean {
  const scheme = urlScheme(url)
  if (!scheme || url.username || url.password) return false
  const rest = url.pathname + url.search + url.hash
  return patterns.some((p) => hostMatches(url, scheme, p) && p.path.test(rest))
}
