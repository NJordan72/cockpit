import { describe, expect, it } from 'bun:test'
import { extractLocalServers, PortTracker, stripAnsi } from './ports'

describe('stripAnsi', () => {
  it('removes CSI color/style codes and OSC hyperlinks', () => {
    const vite =
      '  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m'
    expect(stripAnsi(vite)).toBe('  ➜  Local:   http://localhost:5173/')

    const osc = '\x1b]8;;http://localhost:3000/\x07http://localhost:3000/\x1b]8;;\x07'
    expect(stripAnsi(osc)).toBe('http://localhost:3000/')
  })
})

describe('extractLocalServers', () => {
  it('detects localhost, 127.0.0.1, and [::1] with http and https', () => {
    const text = [
      'Local:   http://localhost:5173/',
      'Loopback: https://127.0.0.1:8443/api',
      'IPv6:    http://[::1]:3000/'
    ].join('\n')
    expect(extractLocalServers(text)).toEqual([
      { url: 'http://localhost:5173', port: 5173 },
      { url: 'https://127.0.0.1:8443/api', port: 8443 },
      { url: 'http://[::1]:3000', port: 3000 }
    ])
  })

  it('extracts URLs wrapped in ANSI escapes and trailing punctuation', () => {
    const line =
      'Server ready at (\x1b[36mhttp://localhost:\x1b[1m4000\x1b[22m/docs\x1b[39m), press q to quit.'
    expect(extractLocalServers(line)).toEqual([{ url: 'http://localhost:4000/docs', port: 4000 }])
  })

  it('ignores non-local hosts and invalid port numbers', () => {
    const text = [
      'https://example.com:8080',
      'http://192.168.1.5:3000',
      'http://localhost:0',
      'http://localhost:080',
      'http://localhost:70000'
    ].join('\n')
    expect(extractLocalServers(text)).toEqual([])
  })
})

describe('PortTracker', () => {
  it('deduplicates repeated URLs per pane and prefers localhost over 127.0.0.1', () => {
    const changes: string[] = []
    const tracker = new PortTracker((id) => changes.push(id))

    tracker.output('p1', 'Listening on http://127.0.0.1:5173/\n')
    tracker.output('p1', 'Listening on http://127.0.0.1:5173/\n')
    expect(tracker.get('p1')).toEqual([{ url: 'http://127.0.0.1:5173', port: 5173 }])
    expect(changes).toEqual(['p1'])

    tracker.output('p1', 'Local: http://localhost:5173/\n')
    expect(tracker.get('p1')).toEqual([{ url: 'http://localhost:5173', port: 5173 }])
    expect(changes).toEqual(['p1', 'p1'])
  })

  it('detects URLs and ANSI escapes split across chunks', () => {
    const changes: string[] = []
    const tracker = new PortTracker((id) => changes.push(id))

    tracker.output('p1', 'Ready at \x1b[3')
    tracker.output('p1', '6mhttp://local')
    tracker.output('p1', 'host:3001/\x1b[39m\n')

    expect(tracker.get('p1')).toEqual([{ url: 'http://localhost:3001', port: 3001 }])
    expect(changes).toEqual(['p1'])
  })

  it('clears detected ports on pane exit or clear and notifies once', () => {
    const changes: string[] = []
    const tracker = new PortTracker((id) => changes.push(id))

    tracker.output('p1', 'http://localhost:5173\n')
    tracker.clear('p1')
    expect(tracker.get('p1')).toEqual([])
    expect(changes).toEqual(['p1', 'p1'])

    // Clearing an already-empty pane does not fire another change.
    tracker.clear('p1')
    expect(changes).toEqual(['p1', 'p1'])
  })
})
