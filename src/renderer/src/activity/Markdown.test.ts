import { describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { decodeEntities, Markdown } from './Markdown'

const html = (text: string): string =>
  renderToStaticMarkup(createElement(Markdown, { text, onLink: () => undefined }))

describe('Markdown', () => {
  it('draws what plans use: headings, lists, code, tables', () => {
    const out = html(
      [
        '# Plan',
        '',
        'Some **bold**, _em_, and `a<b>`.',
        '',
        '- one',
        '  1. nested',
        '',
        '```ts',
        'if (a < b) {}',
        '```',
        '',
        '| A | B |',
        '|:--|--:|',
        '| x | y |'
      ].join('\n')
    )
    expect(out).toContain('<h1>Plan</h1>')
    expect(out).toContain('<strong>bold</strong>, <em>em</em>, and <code>a&lt;b&gt;</code>.')
    expect(out).toContain('<ul><li>one<ol><li>nested</li></ol></li></ul>')
    expect(out).toContain('<pre class="md-code"><code>if (a &lt; b) {}</code></pre>')
    expect(out).toContain('<th style="text-align:left">A</th><th style="text-align:right">B</th>')
  })

  it('shows raw HTML as text and never as markup', () => {
    const out = html('Hi <img src=x onerror="alert(1)"> there\n\n<script>alert(2)</script>\n')
    expect(out).not.toContain('<img')
    expect(out).not.toContain('<script')
    expect(out).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
    expect(out).toContain('&lt;script&gt;alert(2)&lt;/script&gt;')
  })

  it('links only http(s), and shows images as their alt text', () => {
    const out = html('[site](https://x.dev) [js](javascript:alert(1)) ![logo](https://x.dev/a.png)')
    expect(out).toContain('<a href="https://x.dev" title="https://x.dev">site</a>')
    expect(out).toContain('<a title="javascript:alert(1)">js</a>')
    expect(out).not.toContain('<img')
    expect(out).toContain('[logo]')
  })

  it('marks task list items', () => {
    const out = html('- [ ] todo\n- [x] done')
    expect(out).toContain(
      '<li class="md-task"><span class="md-check" role="img" aria-label="To do">'
    )
    expect(out).toContain('<span class="md-check on" role="img" aria-label="Done">')
  })

  it('decodes the entities marked leaves in text', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &#39;d&#x27; &nbsp;&bogus;')).toBe(
      `a & b <c> 'd' ${String.fromCharCode(0xa0)}&bogus;`
    )
    expect(html('R&amp;D')).toBe('<div class="md"><p>R&amp;D</p></div>')
  })
})
