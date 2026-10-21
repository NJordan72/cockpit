import { describe, expect, it } from 'vitest'
import { canOpenExternally, isWebUrl, pageLabel, toWebUrl } from './web'

describe('toWebUrl', () => {
  it('keeps full web URLs', () => {
    expect(toWebUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(toWebUrl('  http://example.com ')).toBe('http://example.com/')
    expect(toWebUrl('file:///Users/me/deck/dist/index.html')).toBe(
      'file:///Users/me/deck/dist/index.html'
    )
  })

  it('turns an absolute path into a file URL', () => {
    expect(toWebUrl('/Users/me/my deck/index.html')).toBe('file:///Users/me/my%20deck/index.html')
  })

  it('uses http for localhost and https for other hosts', () => {
    expect(toWebUrl('localhost:5173')).toBe('http://localhost:5173/')
    expect(toWebUrl('127.0.0.1:8080/x')).toBe('http://127.0.0.1:8080/x')
    expect(toWebUrl('example.com')).toBe('https://example.com/')
    expect(toWebUrl('docs.example.com/guide#top')).toBe('https://docs.example.com/guide#top')
  })

  it('refuses other schemes and plain words', () => {
    expect(toWebUrl('javascript:alert(1)')).toBeNull()
    expect(toWebUrl('cockpit-widget://hello/')).toBeNull()
    expect(toWebUrl('data:text/html,hi')).toBeNull()
    expect(toWebUrl('hello world')).toBeNull()
    expect(toWebUrl('hello')).toBeNull()
    expect(toWebUrl('')).toBeNull()
  })
})

describe('isWebUrl', () => {
  it('allows http, https, and file only', () => {
    expect(isWebUrl('https://x.dev')).toBe(true)
    expect(isWebUrl('file:///tmp/a.html')).toBe(true)
    expect(isWebUrl('cockpit-asset://theme/x')).toBe(false)
    expect(isWebUrl('not a url')).toBe(false)
  })
})

describe('canOpenExternally', () => {
  it('opens web pages but not apps or scripts', () => {
    expect(canOpenExternally('https://x.dev')).toBe(true)
    expect(canOpenExternally('file:///Users/me/index.html')).toBe(true)
    expect(canOpenExternally('file:///Applications/Calculator.app')).toBe(false)
    expect(canOpenExternally('file:///Users/me/run.command')).toBe(false)
  })
})

describe('pageLabel', () => {
  it('names a page by its host or file name', () => {
    expect(pageLabel('https://example.com/a/b')).toBe('example.com')
    expect(pageLabel('file:///Users/me/my%20deck/index.html')).toBe('index.html')
  })
})
