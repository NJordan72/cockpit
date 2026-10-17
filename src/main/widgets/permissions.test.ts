import { describe, expect, it } from 'vitest'
import { hostAllowed, parseHostPattern, parseUrlPattern, urlAllowed } from './permissions'

const hosts = (...p: string[]) => p.map(parseHostPattern)
const allowed = (url: string, ...p: string[]): boolean => hostAllowed(new URL(url), hosts(...p))

describe('parseHostPattern', () => {
  it('defaults to https on 443', () => {
    expect(parseHostPattern('API.Example.com')).toEqual({
      scheme: 'https',
      host: 'api.example.com',
      wildcard: false,
      port: 443
    })
  })

  it('reads scheme, port, wildcard, and IPv6 literals', () => {
    expect(parseHostPattern('http://localhost:3000')).toMatchObject({
      scheme: 'http',
      host: 'localhost',
      port: 3000
    })
    expect(parseHostPattern('*.example.com')).toMatchObject({ host: 'example.com', wildcard: true })
    expect(parseHostPattern('http://[::1]:8080')).toMatchObject({ host: '[::1]', port: 8080 })
    expect(parseHostPattern('https://example.com/')).toMatchObject({ host: 'example.com' })
  })

  it.each([
    ['example.com/api', 'path'],
    ['*', 'leading label'],
    ['*.com', 'too broad'],
    ['api.*.example.com', 'leading label'],
    ['ex ample.com', 'path'],
    ['user@example.com', 'path'],
    ['example.com:0', 'port'],
    ['example.com:99999', 'port'],
    ['example..com', 'valid host'],
    ['-bad.example.com', 'valid host']
  ])('rejects %s', (raw, message) => {
    expect(() => parseHostPattern(raw)).toThrow(message)
  })
})

describe('hostAllowed', () => {
  it('matches the exact host on the default port only', () => {
    expect(allowed('https://api.app.shortcut.com/api/v3/member', 'api.app.shortcut.com')).toBe(true)
    expect(allowed('https://api.app.shortcut.com:443/x', 'api.app.shortcut.com')).toBe(true)
    expect(allowed('https://api.app.shortcut.com:8443/x', 'api.app.shortcut.com')).toBe(false)
    expect(allowed('https://app.shortcut.com/', 'api.app.shortcut.com')).toBe(false)
    expect(allowed('https://evil-api.app.shortcut.com/', 'api.app.shortcut.com')).toBe(false)
  })

  it('does not let a listed name appear elsewhere in the host', () => {
    expect(allowed('https://api.app.shortcut.com.evil.com/', 'api.app.shortcut.com')).toBe(false)
    expect(allowed('https://evil.com/api.app.shortcut.com', 'api.app.shortcut.com')).toBe(false)
    expect(allowed('https://api.app.shortcut.com@evil.com/', 'api.app.shortcut.com')).toBe(false)
  })

  it('refuses credentials in the URL even for an allowed host', () => {
    expect(allowed('https://me:pw@api.example.com/', 'api.example.com')).toBe(false)
  })

  it('needs http to be listed explicitly', () => {
    expect(allowed('http://api.example.com/', 'api.example.com')).toBe(false)
    expect(allowed('http://localhost:3000/x', 'http://localhost:3000')).toBe(true)
    expect(allowed('https://localhost:3000/x', 'http://localhost:3000')).toBe(false)
  })

  it('ignores case and a trailing dot', () => {
    expect(allowed('https://API.Example.COM./x', 'api.example.com')).toBe(true)
  })

  it('wildcards match subdomains but not the bare domain', () => {
    expect(allowed('https://a.example.com/', '*.example.com')).toBe(true)
    expect(allowed('https://a.b.example.com/', '*.example.com')).toBe(true)
    expect(allowed('https://example.com/', '*.example.com')).toBe(false)
    expect(allowed('https://badexample.com/', '*.example.com')).toBe(false)
  })

  it('refuses other schemes', () => {
    expect(allowed('file:///etc/passwd', 'api.example.com')).toBe(false)
    expect(allowed('ftp://api.example.com/', 'api.example.com')).toBe(false)
  })

  it('compares hosts after URL normalization', () => {
    // WHATWG URL turns a backslash into a path separator for http(s).
    expect(allowed('https://api.example.com\\@evil.com/', 'api.example.com')).toBe(true)
    expect(allowed('https://evil.com\\@api.example.com/', 'api.example.com')).toBe(false)
    expect(allowed('https://0x7f.0.0.1/', '127.0.0.1')).toBe(true)
  })
})

describe('parseUrlPattern / urlAllowed', () => {
  const ok = (url: string, ...p: string[]): boolean =>
    urlAllowed(new URL(url), p.map(parseUrlPattern))

  it('matches a host and a path glob', () => {
    expect(ok('https://app.shortcut.com/acme/story/123', 'https://app.shortcut.com/*')).toBe(true)
    expect(ok('https://app.shortcut.com', 'https://app.shortcut.com/*')).toBe(true)
    expect(ok('https://app.shortcut.com/x?y=1#z', 'https://app.shortcut.com/*')).toBe(true)
    expect(ok('https://app.shortcut.com.evil.com/', 'https://app.shortcut.com/*')).toBe(false)
    expect(ok('http://app.shortcut.com/', 'https://app.shortcut.com/*')).toBe(false)
  })

  it('anchors the path', () => {
    const p = 'https://example.com/docs/*'
    expect(ok('https://example.com/docs/a', p)).toBe(true)
    expect(ok('https://example.com/blog/docs/a', p)).toBe(false)
    expect(ok('https://example.com/docs', p)).toBe(false)
    expect(ok('https://example.com/exact', 'https://example.com/exact')).toBe(true)
    expect(ok('https://example.com/exactly', 'https://example.com/exact')).toBe(false)
  })

  it('treats regex characters in the path literally', () => {
    expect(ok('https://example.com/a.b', 'https://example.com/a.b')).toBe(true)
    expect(ok('https://example.com/aXb', 'https://example.com/a.b')).toBe(false)
  })

  it('rejects patterns without a path, or with a wildcard host part', () => {
    expect(() => parseUrlPattern('https://app.shortcut.com')).toThrow('needs a path')
    expect(() => parseUrlPattern('https://app.shortcut.com*')).toThrow()
    expect(() => parseUrlPattern('javascript:alert(1)')).toThrow()
  })

  it('refuses non-http schemes as targets', () => {
    expect(ok('javascript:alert(1)//https://app.shortcut.com/', 'https://app.shortcut.com/*')).toBe(
      false
    )
  })
})
