import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { PaneSession } from '@shared/ipc'
import {
  annunciators,
  attitudeAt,
  blips,
  formatTokens,
  headingTicks,
  hudMetrics,
  PITCH_RUNGS,
  planTraffic,
  totalTokens,
  type Blip
} from './hudModel'

interface Props {
  sessions: readonly PaneSession[]
  /** It moves only while it's on screen. */
  visible: boolean
}

/** About 30 frames a second: the motion is slow, so more buys nothing. */
const FRAME_MS = 33

function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (): void => {
      setReduce(mq.matches)
    }
    mq.addEventListener('change', onChange)
    return () => {
      mq.removeEventListener('change', onChange)
    }
  }, [])
  return reduce
}

/**
 * The built-in banner: a head-up display in the theme's colors. The heading
 * tape and horizon drift through a calm flight, each agent session is a
 * traffic blip, and the lights along the bottom show what needs you.
 */
export function Hud({ sessions, visible }: Props): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const tape = useRef<SVGGElement>(null)
  const horizon = useRef<SVGGElement>(null)
  const readout = useRef<SVGTextElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const reduce = useReducedMotion()
  const uid = `hud${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return
      const w = Math.round(entry.contentRect.width)
      const h = Math.round(entry.contentRect.height)
      setSize((old) => (old?.w === w && old.h === h ? old : { w, h }))
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
    }
  }, [])

  const m = useMemo(() => (size ? hudMetrics(size.w, size.h) : null), [size])
  const ticks = useMemo(() => (m && size ? headingTicks(size.w / 2 / m.ppd) : []), [m, size])

  // The tape and the horizon move by hand each frame, without a render.
  useEffect(() => {
    if (!m) return
    const place = (ms: number): void => {
      const a = attitudeAt(ms)
      tape.current?.setAttribute('transform', `translate(${(-a.heading * m.ppd).toFixed(2)} 0)`)
      horizon.current?.setAttribute(
        'transform',
        `rotate(${(-a.bank).toFixed(3)} ${String(m.cx)} ${String(m.cy)}) translate(0 ${(a.pitch * m.ppp).toFixed(2)})`
      )
      if (readout.current) {
        readout.current.textContent = String(Math.round(a.heading) % 360).padStart(3, '0')
      }
    }
    if (reduce) {
      place(0)
      return
    }
    place(performance.now())
    if (!visible) return
    let raf = 0
    let last = 0
    const frame = (now: number): void => {
      if (now - last >= FRAME_MS) {
        last = now
        place(now)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
    }
  }, [m, visible, reduce])

  const traffic = blips(sessions)
  const lights = annunciators(sessions)
  const tokens = totalTokens(sessions)

  return (
    <div className="hud" ref={box} aria-hidden="true">
      {m && size && (
        <svg width={size.w} height={size.h} viewBox={`0 0 ${String(size.w)} ${String(size.h)}`}>
          <defs>
            <linearGradient id={`${uid}-fade`}>
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset="0.16" stopColor="#fff" />
              <stop offset="0.84" stopColor="#fff" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <mask
              id={`${uid}-mask`}
              maskUnits="userSpaceOnUse"
              x="0"
              y="0"
              width={size.w}
              height={size.h}
            >
              <rect width={size.w} height={size.h} fill={`url(#${uid}-fade)`} />
            </mask>
            <clipPath id={`${uid}-sky`}>
              <rect x="0" y={34 * m.s} width={size.w} height={size.h - 34 * m.s} />
            </clipPath>
          </defs>

          <g mask={`url(#${uid}-mask)`}>
            <HeadingTape ticks={ticks} m={m} tapeRef={tape} />
            <g clipPath={`url(#${uid}-sky)`}>
              <g ref={horizon}>
                <Horizon m={m} width={size.w} />
              </g>
            </g>
          </g>

          {/* The heading readout, over the middle of the tape. */}
          <rect
            className="hud-box"
            x={m.cx - 16 * m.s}
            y={1.5 * m.s}
            width={32 * m.s}
            height={13 * m.s}
            rx={2 * m.s}
          />
          <text
            ref={readout}
            className="hud-readout"
            x={m.cx}
            y={11.5 * m.s}
            fontSize={10.5 * m.s}
            textAnchor="middle"
          />
          <path
            className="hud-fill"
            d={`M${String(m.cx)} ${String(24 * m.s)} l${String(-4 * m.s)} ${String(6 * m.s)} h${String(8 * m.s)} z`}
          />

          <FlightPathMarker m={m} />
          <Traffic blips={traffic} m={m} width={size.w} />

          {lights.map((a, i) => {
            const w = 50 * m.s
            const x = 10 * m.s + i * (w + 5 * m.s)
            const y = size.h - 21 * m.s
            return (
              <g key={a.id} className={`hud-ann ${a.id}${a.count > 0 ? ' on' : ''}`}>
                <rect x={x} y={y} width={w} height={14 * m.s} rx={1.5 * m.s} />
                <text x={x + w / 2} y={y + 10 * m.s} fontSize={8 * m.s} textAnchor="middle">
                  {a.count > 0 ? `${a.label} ${String(a.count)}` : a.label}
                </text>
              </g>
            )
          })}

          {tokens !== null && (
            <text
              className="hud-ctx"
              x={size.w - 10 * m.s}
              y={size.h - 10.5 * m.s}
              fontSize={9 * m.s}
              textAnchor="end"
            >
              <tspan className="hud-ctx-label">CTX </tspan>
              {formatTokens(tokens)}
            </text>
          )}
        </svg>
      )}
    </div>
  )
}

function HeadingTape({
  ticks,
  m,
  tapeRef
}: {
  ticks: ReturnType<typeof headingTicks>
  m: NonNullable<ReturnType<typeof hudMetrics>>
  tapeRef: React.RefObject<SVGGElement | null>
}): React.JSX.Element {
  const top = 15 * m.s
  return (
    <g ref={tapeRef}>
      {ticks.map((t) => {
        const x = m.cx + t.deg * m.ppd
        return (
          <g key={t.deg}>
            <line
              className={t.major ? 'hud-line' : 'hud-line minor'}
              x1={x}
              x2={x}
              y1={top}
              y2={top + (t.major ? 7 : 4) * m.s}
              strokeWidth={1.2 * m.s}
            />
            {t.label && (
              <text
                className="hud-label"
                x={x}
                y={11 * m.s}
                fontSize={9.5 * m.s}
                textAnchor="middle"
              >
                {t.label}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
}

function Horizon({
  m,
  width
}: {
  m: NonNullable<ReturnType<typeof hudMetrics>>
  width: number
}): React.JSX.Element {
  const gap = 62 * m.s
  const inner = 24 * m.s
  const outer = 56 * m.s
  return (
    <>
      <line
        className="hud-line"
        x1={-width}
        x2={m.cx - gap}
        y1={m.cy}
        y2={m.cy}
        strokeWidth={1.6 * m.s}
      />
      <line
        className="hud-line"
        x1={m.cx + gap}
        x2={2 * width}
        y1={m.cy}
        y2={m.cy}
        strokeWidth={1.6 * m.s}
      />
      {PITCH_RUNGS.map((p) => {
        const y = m.cy - p * m.ppp
        // End ticks point at the horizon; rungs below it are dashed.
        const tick = (p > 0 ? 4 : -4) * m.s
        const dash = p < 0 ? `${String(4 * m.s)} ${String(3 * m.s)}` : undefined
        return (
          <g key={p}>
            <path
              className="hud-line rung"
              d={`M${String(m.cx - outer)} ${String(y + tick)} V${String(y)} H${String(m.cx - inner)} M${String(m.cx + inner)} ${String(y)} H${String(m.cx + outer)} V${String(y + tick)}`}
              strokeWidth={1.1 * m.s}
              strokeDasharray={dash}
            />
            <text
              className="hud-label minor"
              x={m.cx - outer - 4 * m.s}
              y={y + 3 * m.s}
              fontSize={8.5 * m.s}
              textAnchor="end"
            >
              {Math.abs(p)}
            </text>
            <text
              className="hud-label minor"
              x={m.cx + outer + 4 * m.s}
              y={y + 3 * m.s}
              fontSize={8.5 * m.s}
            >
              {Math.abs(p)}
            </text>
          </g>
        )
      })}
    </>
  )
}

function FlightPathMarker({
  m
}: {
  m: NonNullable<ReturnType<typeof hudMetrics>>
}): React.JSX.Element {
  const r = 5 * m.s
  const { cx, cy, s } = m
  return (
    <path
      className="hud-line marker"
      d={`M${String(cx - r)} ${String(cy)} a${String(r)} ${String(r)} 0 1 0 ${String(2 * r)} 0 a${String(r)} ${String(r)} 0 1 0 ${String(-2 * r)} 0 M${String(cx - r)} ${String(cy)} h${String(-13 * s)} M${String(cx + r)} ${String(cy)} h${String(13 * s)} M${String(cx)} ${String(cy - r)} v${String(-6 * s)}`}
      strokeWidth={1.8 * s}
    />
  )
}

function Traffic({
  blips: list,
  m,
  width
}: {
  blips: Blip[]
  m: NonNullable<ReturnType<typeof hudMetrics>>
  width: number
}): React.JSX.Element {
  const plan = planTraffic(list.length, m, width)
  const y = m.cy - 46 * m.s
  const r = 5 * m.s
  return (
    <>
      {list.slice(0, plan.xs.length).map((b, i) => {
        const x = plan.xs[i]
        if (x === undefined) return null
        const diamond = `M${String(x)} ${String(y - r)} L${String(x + r)} ${String(y)} L${String(x)} ${String(y + r)} L${String(x - r)} ${String(y)} Z`
        const c = 9 * m.s
        const k = 3.5 * m.s
        return (
          <g key={b.id} className={`hud-blip ${b.status}`}>
            {b.status === 'needs-input' ? (
              <circle className="hud-glyph" cx={x} cy={y} r={r} />
            ) : (
              <path className="hud-glyph" d={diamond} strokeWidth={1.4 * m.s} />
            )}
            {b.focused && (
              <path
                className="hud-target"
                d={[
                  [-1, -1],
                  [1, -1],
                  [1, 1],
                  [-1, 1]
                ]
                  .map(
                    ([sx = 0, sy = 0]) =>
                      `M${String(x + sx * c)} ${String(y + sy * c - sy * k)} V${String(y + sy * c)} H${String(x + sx * c - sx * k)}`
                  )
                  .join(' ')}
                strokeWidth={1.1 * m.s}
              />
            )}
            {b.tag && (
              <text
                className="hud-tag"
                x={x}
                y={y - 12 * m.s}
                fontSize={8 * m.s}
                textAnchor="middle"
              >
                {b.tag}
              </text>
            )}
            <text
              className="hud-name"
              x={x}
              y={y + 19 * m.s}
              fontSize={8.5 * m.s}
              textAnchor="middle"
            >
              {b.label}
            </text>
          </g>
        )
      })}
      {plan.more !== null && (
        <text
          className="hud-name"
          x={plan.more}
          y={y + 3 * m.s}
          fontSize={9 * m.s}
          textAnchor="middle"
        >
          +{plan.hidden}
        </text>
      )}
    </>
  )
}
