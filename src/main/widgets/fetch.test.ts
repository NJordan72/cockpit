import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { brokerFetch, MAX_RESPONSE_BYTES, type FetchPolicy } from './fetch'
import { parseHostPattern } from './permissions'

let server: http.Server
let base = ''
let port = 0

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    switch (url.pathname) {
      case '/echo': {
        let body = ''
        req.on('data', (c: Buffer) => (body += c.toString()))
        req.on('end', () => {
          res.setHeader('content-type', 'application/json')
          res.setHeader('x-test', 'yes')
          res.end(JSON.stringify({ method: req.method, body, auth: req.headers.authorization }))
        })
        return
      }
      case '/to-echo':
        res.writeHead(302, { location: '/echo' })
        res.end()
        return
      case '/see-other':
        res.writeHead(303, { location: '/echo' })
        res.end()
        return
      case '/to-elsewhere':
        // Same server under a name the policy doesn't list.
        res.writeHead(302, { location: `http://localhost:${port}/echo` })
        res.end()
        return
      case '/loop':
        res.writeHead(302, { location: '/loop' })
        res.end()
        return
      case '/huge':
        res.end(Buffer.alloc(MAX_RESPONSE_BYTES + 1, 'a'))
        return
      case '/slow':
        setTimeout(() => res.end('late'), 500)
        return
      default:
        res.writeHead(404)
        res.end('nope')
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  port = (server.address() as AddressInfo).port
  base = `http://127.0.0.1:${port}`
})

afterAll(() => {
  server.close()
})

const policy = (): FetchPolicy => {
  const listed = [`http://127.0.0.1:${port}`]
  return { listed, patterns: listed.map(parseHostPattern) }
}

describe('brokerFetch', () => {
  it('returns status, headers, and body text from an allowed host', async () => {
    const res = await brokerFetch(
      `${base}/echo`,
      { method: 'post', body: 'hi', headers: { Authorization: 'Bearer t' } },
      policy()
    )
    expect(res).toMatchObject({ ok: true, status: 200, redirected: false, url: `${base}/echo` })
    expect(res.headers['x-test']).toBe('yes')
    expect(JSON.parse(res.body)).toEqual({ method: 'POST', body: 'hi', auth: 'Bearer t' })
  })

  it('reports non-2xx responses instead of throwing', async () => {
    const res = await brokerFetch(`${base}/missing`, undefined, policy())
    expect(res).toMatchObject({ ok: false, status: 404, body: 'nope' })
  })

  it('refuses a host that is not listed, naming the host and what is listed', async () => {
    const err = brokerFetch('https://example.org/', undefined, policy())
    await expect(err).rejects.toMatchObject({ code: 'permission_denied' })
    await expect(err).rejects.toThrow(/example\.org.*permissions\.network.*127\.0\.0\.1/)
  })

  it('follows redirects within the allowlist', async () => {
    const res = await brokerFetch(`${base}/to-echo`, undefined, policy())
    expect(res).toMatchObject({ status: 200, redirected: true, url: `${base}/echo` })
  })

  it('turns POST into GET on 303', async () => {
    const res = await brokerFetch(`${base}/see-other`, { method: 'POST', body: 'x' }, policy())
    expect(JSON.parse(res.body)).toMatchObject({ method: 'GET', body: '' })
  })

  it('refuses a redirect to a host that is not listed', async () => {
    await expect(brokerFetch(`${base}/to-elsewhere`, undefined, policy())).rejects.toMatchObject({
      code: 'permission_denied',
      message: expect.stringContaining('redirect') as unknown
    })
  })

  it('stops redirect loops', async () => {
    await expect(brokerFetch(`${base}/loop`, undefined, policy())).rejects.toMatchObject({
      code: 'network_error'
    })
  })

  it('caps the response size', async () => {
    await expect(brokerFetch(`${base}/huge`, undefined, policy())).rejects.toMatchObject({
      code: 'too_large'
    })
  })

  it('times out', async () => {
    await expect(brokerFetch(`${base}/slow`, { timeoutMs: 50 }, policy())).rejects.toMatchObject({
      code: 'timeout'
    })
  })

  it('validates arguments', async () => {
    await expect(brokerFetch(42, undefined, policy())).rejects.toMatchObject({
      code: 'invalid_argument'
    })
    await expect(brokerFetch('/relative', undefined, policy())).rejects.toMatchObject({
      code: 'invalid_argument'
    })
    await expect(
      brokerFetch(`${base}/echo`, { method: 'GET', body: 'x' }, policy())
    ).rejects.toMatchObject({ code: 'invalid_argument' })
    await expect(brokerFetch(`${base}/echo`, { method: 'TRACE' }, policy())).rejects.toMatchObject({
      code: 'invalid_argument'
    })
  })

  it('reports connection failures as network errors', async () => {
    const closed = http.createServer()
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r))
    const p = (closed.address() as AddressInfo).port
    closed.close()
    const listed = [`http://127.0.0.1:${p}`]
    await expect(
      brokerFetch(`http://127.0.0.1:${p}/`, undefined, {
        listed,
        patterns: listed.map(parseHostPattern)
      })
    ).rejects.toMatchObject({
      code: 'network_error',
      message: expect.stringContaining('ECONNREFUSED') as unknown
    })
  })
})
