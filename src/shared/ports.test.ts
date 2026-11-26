import { describe, expect, it } from 'bun:test'
import { portCollisions } from './ports'

describe('portCollisions', () => {
  it('returns an empty map when no ports collide', () => {
    const map = portCollisions([
      { id: 'pane-1', ports: [{ url: 'http://localhost:5173', port: 5173 }] },
      { id: 'pane-2', ports: [{ url: 'http://localhost:3000', port: 3000 }] }
    ])
    expect(map.size).toBe(0)
  })

  it('detects ports shared across different panes', () => {
    const map = portCollisions([
      {
        id: 'pane-1',
        ports: [
          { url: 'http://localhost:5173', port: 5173 },
          { url: 'http://localhost:8080', port: 8080 }
        ]
      },
      { id: 'pane-2', ports: [{ url: 'http://127.0.0.1:5173', port: 5173 }] },
      { id: 'pane-3', ports: [{ url: 'http://[::1]:5173', port: 5173 }] }
    ])
    expect(map.get(5173)).toEqual(['pane-1', 'pane-2', 'pane-3'])
    expect(map.has(8080)).toBe(false)
  })

  it('ignores duplicate ports within the same pane', () => {
    const map = portCollisions([
      {
        id: 'pane-1',
        ports: [
          { url: 'http://localhost:5173', port: 5173 },
          { url: 'http://127.0.0.1:5173', port: 5173 }
        ]
      }
    ])
    expect(map.size).toBe(0)
  })
})
