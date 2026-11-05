import { describe, expect, it } from 'bun:test'
import {
  annunciators,
  attitudeAt,
  blips,
  formatTokens,
  headingLabel,
  headingTicks,
  hudMetrics,
  planTraffic,
  shortName,
  totalTokens,
  trafficSlots
} from './hudModel'

describe('headingLabel', () => {
  it('names the cardinal points and gives tens of degrees otherwise', () => {
    expect([0, 30, 90, 120, 180, 270, 330, 360].map(headingLabel)).toEqual([
      'N',
      '03',
      'E',
      '12',
      'S',
      'W',
      '33',
      'N'
    ])
  })
})

describe('headingTicks', () => {
  it('runs past both ends so the tape wraps through north', () => {
    const ticks = headingTicks(77)
    expect(ticks[0]?.deg).toBeLessThanOrEqual(-77)
    expect(ticks.at(-1)?.deg).toBeGreaterThanOrEqual(360 + 77)
    // -30 and 330 are the same point on the compass.
    expect(ticks.find((t) => t.deg === -30)?.label).toBe('33')
    expect(ticks.find((t) => t.deg === 330)?.label).toBe('33')
  })

  it('makes every tenth degree a long tick and labels every thirtieth', () => {
    const ticks = headingTicks(20)
    expect(ticks.find((t) => t.deg === 10)).toMatchObject({ major: true, label: null })
    expect(ticks.find((t) => t.deg === 15)).toMatchObject({ major: false, label: null })
    expect(ticks.find((t) => t.deg === 90)).toMatchObject({ major: true, label: 'E' })
  })
})

describe('attitudeAt', () => {
  it('stays calm and in range', () => {
    for (let ms = 0; ms < 600_000; ms += 7_919) {
      const a = attitudeAt(ms)
      expect(a.heading).toBeGreaterThanOrEqual(0)
      expect(a.heading).toBeLessThan(360)
      expect(Math.abs(a.bank)).toBeLessThanOrEqual(4.7)
      expect(Math.abs(a.pitch)).toBeLessThanOrEqual(2.1)
    }
  })

  it('starts level on 247', () => {
    expect(attitudeAt(0)).toEqual({ heading: 247, bank: 0, pitch: 0.5 })
  })
})

describe('traffic', () => {
  const session = (
    id: string,
    extra: Partial<Parameters<typeof blips>[0][number]> = {}
  ): Parameters<typeof blips>[0][number] => ({
    id,
    cwd: `~/dev/${id}`,
    status: 'idle',
    agent: 'claude',
    tokens: null,
    focused: false,
    ...extra
  })

  it('shows agent panes only, named for their folder, with their context size', () => {
    expect(
      blips([
        session('api', { tokens: 42_300, status: 'working' }),
        session('shell', { agent: null }),
        session('a-very-long-project-name')
      ])
    ).toEqual([
      { id: 'api', status: 'working', label: 'api', tag: '42k', focused: false },
      {
        id: 'a-very-long-project-name',
        status: 'idle',
        label: 'a-very-long…',
        tag: null,
        focused: false
      }
    ])
  })

  it('alternates slots right and left of the center, as many as fit', () => {
    const m = hudMetrics(1000, 180)
    expect(trafficSlots(m, 1000)).toEqual([635, 365, 735, 265, 835, 165, 935, 65])
    expect(trafficSlots(hudMetrics(300, 180), 300)).toEqual([])
  })

  it('places blips nearest the center, left to right in session order', () => {
    const m = hudMetrics(1000, 180)
    expect(planTraffic(3, m, 1000)).toEqual({ xs: [365, 635, 735], hidden: 0, more: null })
    // Eight slots for ten sessions: seven blips and "+3" on the right.
    expect(planTraffic(10, m, 1000)).toEqual({
      xs: [65, 165, 265, 365, 635, 735, 835],
      hidden: 3,
      more: 935
    })
    expect(planTraffic(2, hudMetrics(300, 180), 300)).toEqual({ xs: [], hidden: 2, more: null })
  })

  it('counts panes for the lights and adds up context', () => {
    const sessions = [
      session('a', { status: 'working', tokens: 1000 }),
      session('b', { status: 'needs-input', tokens: 500 }),
      session('c', { status: 'working' })
    ]
    expect(annunciators(sessions).map((a) => a.count)).toEqual([2, 1, 0])
    expect(totalTokens(sessions)).toBe(1500)
    expect(totalTokens([session('d')])).toBeNull()
  })
})

describe('formatting', () => {
  it('shortens token counts and paths', () => {
    expect([999, 1000, 186_400, 1_250_000].map(formatTokens)).toEqual(['999', '1k', '186k', '1.3M'])
    expect(shortName('~/dev/cockpit')).toBe('cockpit')
    expect(shortName('~')).toBe('~')
    expect(shortName('/')).toBe('/')
  })
})
