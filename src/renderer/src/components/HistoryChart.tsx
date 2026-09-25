import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { useT } from '../store'

export interface Series {
  key: string
  label: string
  /** Categorical slot 1..3 (colour follows the entity, see styles.css --series-N). */
  slot: number
  values: (number | null)[]
}

const H = 170
const PAD = { l: 44, r: 12, t: 10, b: 22 }
/** Gaps longer than this (e.g. suspend) break the line instead of bridging it. */
const MAX_GAP_MS = 20_000

function niceStep(span: number, count: number): number {
  const raw = span / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const n = raw / mag
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag
}

function fmt(v: number | null, digits: number): string {
  return v === null ? '–' : v.toFixed(digits)
}

/**
 * A small time-series line chart: one y-axis, 2px lines, recessive grid, a
 * crosshair tooltip on hover and arrow-key reading on focus.
 */
export function HistoryChart({
  title,
  unit,
  times,
  series,
  rangeMs,
  zero = false,
  digits = 0
}: {
  title: string
  unit: string
  times: number[]
  series: Series[]
  rangeMs: number
  /** Keep 0 inside the y-range (fans, power). */
  zero?: boolean
  digits?: number
}): ReactNode {
  const t = useT()
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(480)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, Math.floor(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const end = times.length ? times[times.length - 1] : Date.now()
  const start = end - rangeMs
  const first = times.findIndex((x) => x >= start)
  const from = first < 0 ? times.length : first

  const { lo, hi, ticks } = useMemo(() => {
    const vals = series.flatMap((s) => s.values.slice(from)).filter((v): v is number => v !== null)
    let lo = vals.length ? Math.min(...vals) : 0
    let hi = vals.length ? Math.max(...vals) : 1
    if (zero) {
      lo = Math.min(lo, 0)
      hi = Math.max(hi, 0)
    }
    if (hi - lo < 1e-9) {
      hi += 1
      lo -= zero && lo >= 0 ? 0 : 1
    }
    const step = niceStep(hi - lo, 4)
    lo = Math.floor(lo / step) * step
    hi = Math.ceil(hi / step) * step
    const ticks: number[] = []
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6)
    return { lo, hi, ticks }
  }, [series, from, zero])

  const plotW = width - PAD.l - PAD.r
  const plotH = H - PAD.t - PAD.b
  const x = (time: number): number => PAD.l + ((time - start) / rangeMs) * plotW
  const y = (v: number): number => PAD.t + (1 - (v - lo) / (hi - lo)) * plotH

  const paths = series.map((s) => {
    let d = ''
    let pen = false
    for (let i = from; i < times.length; i++) {
      const v = s.values[i]
      if (v === null || (i > from && times[i] - times[i - 1] > MAX_GAP_MS)) pen = false
      if (v === null) continue
      d += `${pen ? 'L' : 'M'}${x(times[i]).toFixed(1)},${y(v).toFixed(1)}`
      pen = true
    }
    return d
  })

  const minutes = Math.round(rangeMs / 60000)
  const xTicks = [minutes, minutes / 2, 0]

  const pick = (e: PointerEvent<SVGSVGElement>): void => {
    if (from >= times.length) return
    const r = e.currentTarget.getBoundingClientRect()
    const time = start + ((e.clientX - r.left - PAD.l) / plotW) * rangeMs
    let best = from
    for (let i = from; i < times.length; i++) if (Math.abs(times[i] - time) < Math.abs(times[best] - time)) best = i
    setHover(best)
  }

  const onKey = (e: KeyboardEvent): void => {
    if (from >= times.length) return
    const cur = hover ?? times.length - 1
    if (e.key === 'ArrowLeft') setHover(Math.max(from, cur - 1))
    else if (e.key === 'ArrowRight') setHover(Math.min(times.length - 1, cur + 1))
    else if (e.key === 'Home') setHover(from)
    else if (e.key === 'End') setHover(times.length - 1)
    else if (e.key === 'Escape') setHover(null)
    else return
    e.preventDefault()
  }

  const stats = (vals: (number | null)[]): { now: number | null; min: number | null; max: number | null } => {
    const v = vals.slice(from).filter((n): n is number => n !== null)
    return {
      now: vals[times.length - 1] ?? null,
      min: v.length ? Math.min(...v) : null,
      max: v.length ? Math.max(...v) : null
    }
  }

  const h = hover !== null && hover >= from ? hover : null
  const tipLeft = h !== null ? x(times[h]) : 0

  return (
    <div className="chart">
      {/* Legend with direct values: identity never rests on colour alone. */}
      <ul className="chart-legend">
        {series.map((s) => {
          const st = stats(s.values)
          return (
            <li key={s.key}>
              <span className="line-key" data-slot={s.slot} />
              <span className="chart-series">{s.label}</span>
              <span className="muted">
                {t('monitor.stats', {
                  now: `${fmt(st.now, digits)}${unit}`,
                  min: fmt(st.min, digits),
                  max: fmt(st.max, digits)
                })}
              </span>
            </li>
          )
        })}
      </ul>
      <div className="chart-plot" ref={box}>
        <svg
          width={width}
          height={H}
          role="img"
          tabIndex={0}
          aria-label={t('monitor.chart', { title })}
          onPointerMove={pick}
          onPointerLeave={() => setHover(null)}
          onKeyDown={onKey}
          onBlur={() => setHover(null)}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line className={v === 0 && lo < 0 ? 'chart-zero' : 'chart-grid'} x1={PAD.l} x2={width - PAD.r} y1={y(v)} y2={y(v)} />
              <text className="chart-axis" x={PAD.l - 6} y={y(v)} textAnchor="end" dominantBaseline="middle">
                {v}
              </text>
            </g>
          ))}
          {xTicks.map((m, i) => (
            <text
              key={i}
              className="chart-axis"
              x={x(end - m * 60000)}
              y={H - 6}
              textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
            >
              {m === 0 ? t('monitor.now') : t('monitor.ago', { n: m })}
            </text>
          ))}
          {paths.map((d, i) => (
            <path key={series[i].key} className="chart-line" data-slot={series[i].slot} d={d} />
          ))}
          {h !== null && (
            <g>
              <line className="chart-cross" x1={tipLeft} x2={tipLeft} y1={PAD.t} y2={PAD.t + plotH} />
              {series.map((s) =>
                s.values[h] == null ? null : (
                  <circle key={s.key} className="chart-dot" data-slot={s.slot} cx={tipLeft} cy={y(s.values[h]!)} r={4} />
                )
              )}
            </g>
          )}
        </svg>
        {h !== null && (
          <div
            className="chart-tip"
            style={{ left: Math.min(Math.max(tipLeft, 70), width - 70) }}
            role="status"
          >
            <small>{new Date(times[h]).toLocaleTimeString()}</small>
            {series.map((s) => (
              <div key={s.key}>
                <span className="line-key" data-slot={s.slot} />
                <strong>
                  {fmt(s.values[h], digits)}
                  {unit}
                </strong>
                <span className="muted">{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
