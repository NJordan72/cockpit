import { describe, expect, it } from 'bun:test'
import type { PaneLabel } from '@shared/widgets'
import { WidgetCallError } from './errors'
import { LABEL_LIMITS, parseLabel, SessionLabels } from './labels'

const anyUrl = (url: string): string => new URL(url).href

const parse = (raw: unknown): ReturnType<typeof parseLabel> => parseLabel(raw, anyUrl)

const codeOf = (fn: () => unknown): string | null => {
  try {
    fn()
    return null
  } catch (err) {
    return err instanceof WidgetCallError ? err.code : 'not a WidgetCallError'
  }
}

describe('parseLabel', () => {
  it('fills in what a label leaves out', () => {
    expect(parse({ key: 'SC-1', title: 'Fix it' })).toEqual({
      key: 'SC-1',
      title: 'Fix it',
      facts: [],
      detail: null,
      url: null
    })
    expect(parse({ key: 'SC-1', title: '', facts: null, detail: null, url: null })).toMatchObject({
      title: '',
      facts: [],
      detail: null,
      url: null
    })
  })

  it('keeps each line to one line, and the tooltip to its own lines', () => {
    expect(
      parse({
        key: ' SC-1\n',
        title: 'Fix\tthe\r\nlogin\u0007  page',
        facts: [' 3 pts ', '', '  ', 'In\nReview'],
        detail: '  Feature\r\nEpic: Login\u0000\n\tLabels: auth  '
      })
    ).toEqual({
      key: 'SC-1',
      title: 'Fix the login page',
      facts: ['3 pts', 'In Review'],
      detail: 'Feature\nEpic: Login\n\tLabels: auth',
      url: null
    })
    expect(parse({ key: 'SC-1', title: 'x', detail: ' \n ' }).detail).toBeNull()
  })

  it('cuts each part to its limit, ending it with an ellipsis', () => {
    const label = parse({
      key: 'K'.repeat(100),
      title: 'T'.repeat(500),
      facts: ['F'.repeat(100)],
      detail: 'D'.repeat(5000)
    })
    expect(label.key).toBe('K'.repeat(LABEL_LIMITS.key - 1) + '…')
    expect(label.title).toBe('T'.repeat(LABEL_LIMITS.title - 1) + '…')
    expect(label.facts).toEqual(['F'.repeat(LABEL_LIMITS.fact - 1) + '…'])
    expect(label.detail).toBe('D'.repeat(LABEL_LIMITS.detail - 1) + '…')
    expect(parse({ key: 'K'.repeat(LABEL_LIMITS.key), title: '' }).key).toHaveLength(
      LABEL_LIMITS.key
    )
    // Never in the middle of an emoji, even one made of several code points.
    expect(parse({ key: '🎰'.repeat(30), title: '' }).key).toBe('🎰'.repeat(23) + '…')
    expect(parse({ key: '👩‍💻'.repeat(30), title: '' }).key).toBe('👩‍💻'.repeat(23) + '…')
    expect(parse({ key: '🎰'.repeat(20), title: '' }).key).toBe('🎰'.repeat(20))
  })

  it('refuses labels that are the wrong shape', () => {
    const cases: unknown[] = [
      'SC-1',
      ['SC-1'],
      { title: 'x' },
      { key: 'SC-1' },
      { key: '  ', title: 'x' },
      { key: 1, title: 'x' },
      { key: 'SC-1', title: 'x', facts: 'a, b' },
      { key: 'SC-1', title: 'x', facts: [1] },
      { key: 'SC-1', title: 'x', facts: ['1', '2', '3', '4', '5', '6', '7'] },
      { key: 'SC-1', title: 'x', detail: 5 },
      { key: 'SC-1', title: 'x', url: 5 },
      { key: 'SC-1', title: 'x', url: 'https://a.example.com/' + 'x'.repeat(LABEL_LIMITS.url) }
    ]
    for (const raw of cases)
      expect(
        codeOf(() => parse(raw)),
        JSON.stringify(raw)
      ).toBe('invalid_argument')
    expect(
      parse({ key: 'SC-1', title: 'x', facts: ['1', '2', '3', '4', '5', '6'] }).facts
    ).toHaveLength(6)
  })

  it('passes the URL through the check and keeps the form it returns', () => {
    const seen: string[] = []
    const label = parseLabel({ key: 'SC-1', title: 'x', url: 'https://A.example.com/s' }, (url) => {
      seen.push(url)
      return 'https://a.example.com/s'
    })
    expect(seen).toEqual(['https://A.example.com/s'])
    expect(label.url).toBe('https://a.example.com/s')
    const refused = (): never => {
      throw new WidgetCallError('permission_denied', 'no')
    }
    expect(codeOf(() => parseLabel({ key: 'SC-1', title: 'x', url: 'https://b/' }, refused))).toBe(
      'permission_denied'
    )
  })
})

const label = (widgetId: string, title = 'x'): PaneLabel => ({
  widgetId,
  widgetName: widgetId,
  key: 'SC-1',
  title,
  facts: [],
  detail: null,
  url: null
})

describe('SessionLabels', () => {
  it('keeps one label per widget on each pane, ordered by widget, and says when they change', () => {
    const labels = new SessionLabels()
    expect(labels.set('p1', 'zeta', label('zeta'))).toBe(true)
    expect(labels.set('p1', 'alpha', label('alpha'))).toBe(true)
    expect(labels.set('p1', 'alpha', label('alpha'))).toBe(false)
    expect(labels.set('p1', 'alpha', label('alpha', 'y'))).toBe(true)
    expect(labels.of('p1').map((l) => [l.widgetId, l.title])).toEqual([
      ['alpha', 'y'],
      ['zeta', 'x']
    ])
    expect(labels.get('p1', 'zeta')?.title).toBe('x')
    expect(labels.set('p1', 'zeta', null)).toBe(true)
    expect(labels.set('p1', 'zeta', null)).toBe(false)
    expect(labels.set('p2', 'zeta', null)).toBe(false)
    expect(labels.of('p1').map((l) => l.widgetId)).toEqual(['alpha'])
    expect(labels.of('p2')).toEqual([])
  })

  it("drops a widget's labels, and a closed pane's", () => {
    const labels = new SessionLabels()
    labels.set('p1', 'a', label('a'))
    labels.set('p1', 'b', label('b'))
    labels.set('p2', 'a', label('a'))
    expect(labels.dropWidget('a')).toBe(true)
    expect(labels.dropWidget('a')).toBe(false)
    expect(labels.of('p1').map((l) => l.widgetId)).toEqual(['b'])
    expect(labels.of('p2')).toEqual([])

    labels.set('p2', 'a', label('a'))
    expect(labels.retainWidgets(new Set(['a']))).toBe(true)
    expect(labels.retainWidgets(new Set(['a']))).toBe(false)
    expect(labels.of('p1')).toEqual([])
    expect(labels.of('p2').map((l) => l.widgetId)).toEqual(['a'])

    labels.set('p3', 'a', label('a'))
    labels.retainPanes(new Set(['p3']))
    expect(labels.of('p2')).toEqual([])
    expect(labels.of('p3').map((l) => l.widgetId)).toEqual(['a'])
  })
})
