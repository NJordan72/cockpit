import { describe, expect, it } from 'bun:test'
import { contentType, injectIntoHtml, resolveWidgetFile, widgetCsp } from './serve'

const root = '/Users/me/dev/hello'

describe('resolveWidgetFile', () => {
  it('maps URL paths into the widget folder', () => {
    expect(resolveWidgetFile(root, '/index.html')).toBe(`${root}/index.html`)
    expect(resolveWidgetFile(root, '/lib/app%20v2.js')).toBe(`${root}/lib/app v2.js`)
    expect(resolveWidgetFile(root, '/a/../b.css')).toBe(`${root}/b.css`)
  })

  it('refuses paths that escape the folder or are malformed', () => {
    expect(resolveWidgetFile(root, '/../secrets/x.bin')).toBeNull()
    expect(resolveWidgetFile(root, '/%2e%2e/%2e%2e/etc/passwd')).toBeNull()
    expect(resolveWidgetFile(root, '/..%2fhello-other/x')).toBeNull()
    expect(resolveWidgetFile(root, '/%E0%A4%A')).toBeNull()
    expect(resolveWidgetFile(root, '/x%00.html')).toBeNull()
    expect(resolveWidgetFile(root, '/..\\x')).toBeNull()
    expect(resolveWidgetFile(root, '/')).toBeNull()
  })
})

describe('injectIntoHtml', () => {
  it('goes after the doctype so the page stays in standards mode', () => {
    expect(injectIntoHtml('<!DOCTYPE html>\n<html>', '<s>')).toBe('<!DOCTYPE html><s>\n<html>')
    expect(injectIntoHtml('\uFEFF <!doctype html><p>', '<s>')).toBe('\uFEFF <!doctype html><s><p>')
  })

  it('goes first in a fragment without a doctype', () => {
    expect(injectIntoHtml('<div>hi</div>', '<s>')).toBe('<s><div>hi</div>')
  })
})

describe('widgetCsp', () => {
  it('blocks connections and limits loads to the widget itself', () => {
    const csp = widgetCsp('hello')
    expect(csp).toContain("connect-src 'none'")
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain('script-src cockpit-widget://hello ')
    expect(csp).not.toMatch(/https?:/)
  })
})

describe('contentType', () => {
  it('knows common web types and falls back to octet-stream', () => {
    expect(contentType('a/b.HTML')).toBe('text/html; charset=utf-8')
    expect(contentType('x.mjs')).toBe('text/javascript; charset=utf-8')
    expect(contentType('x.unknown')).toBe('application/octet-stream')
  })
})
