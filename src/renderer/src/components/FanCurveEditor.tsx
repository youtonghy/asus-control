import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { movePoint, pwmToPercent, percentToPwm } from '@shared/asus'
import { useT } from '../store'

interface Curve {
  temp: number[]
  pwm: number[]
}

const W = 640
const H = 300
const PAD = { l: 44, r: 16, t: 14, b: 32 }
const T_MIN = 20
const T_MAX = 110

const x = (t: number): number => PAD.l + ((t - T_MIN) / (T_MAX - T_MIN)) * (W - PAD.l - PAD.r)
const y = (pct: number): number => PAD.t + (1 - pct / 100) * (H - PAD.t - PAD.b)
const tFromX = (px: number): number => T_MIN + ((px - PAD.l) / (W - PAD.l - PAD.r)) * (T_MAX - T_MIN)
const pctFromY = (py: number): number => (1 - (py - PAD.t) / (H - PAD.t - PAD.b)) * 100

function path(c: Curve): string {
  return c.temp.map((t, i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(pwmToPercent(c.pwm[i])).toFixed(1)}`).join(' ')
}

/**
 * Drag-to-edit 8-point fan curve, in the spirit of G-Helper's fan editor.
 * Points push their neighbours to keep the curve monotonic (asusd rejects
 * decreasing curves). Arrow keys nudge the focused point for keyboard users.
 */
export function FanCurveEditor({
  curve,
  saved,
  liveTemp,
  label,
  onChange
}: {
  curve: Curve
  /** The curve currently stored in asusd, drawn as a ghost while editing. */
  saved?: Curve
  liveTemp?: number | null
  label: string
  onChange: (c: Curve) => void
}): ReactNode {
  const t = useT()
  const svg = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const [focus, setFocus] = useState<number | null>(null)

  const toSvg = (e: PointerEvent): { px: number; py: number } => {
    const el = svg.current!
    const pt = el.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const p = pt.matrixTransform(el.getScreenCTM()!.inverse())
    return { px: p.x, py: p.y }
  }

  const update = (i: number, temp: number, pct: number): void => {
    onChange(movePoint(curve, i, temp, percentToPwm(pct), [T_MIN, T_MAX]))
  }

  const onMove = (e: PointerEvent): void => {
    if (drag === null) return
    const { px, py } = toSvg(e)
    update(drag, tFromX(px), pctFromY(py))
  }

  const onKey = (i: number, e: KeyboardEvent): void => {
    const step = e.shiftKey ? 5 : 1
    const t = curve.temp[i]
    const pct = pwmToPercent(curve.pwm[i])
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [t - step, pct],
      ArrowRight: [t + step, pct],
      ArrowUp: [t, pct + step],
      ArrowDown: [t, pct - step]
    }
    const m = moves[e.key]
    if (!m) return
    e.preventDefault()
    update(i, m[0], m[1])
  }

  const dirty = saved && (saved.temp.join() !== curve.temp.join() || saved.pwm.join() !== curve.pwm.join())
  const active = drag ?? focus

  return (
    <svg
      ref={svg}
      className="curve"
      viewBox={`0 0 ${W} ${H}`}
      role="group"
      aria-label={label}
      onPointerMove={onMove}
      onPointerUp={() => setDrag(null)}
      onPointerLeave={() => setDrag(null)}
    >
      {/* grid */}
      {[0, 20, 40, 60, 80, 100].map((p) => (
        <g key={`y${p}`}>
          <line className="grid-line" x1={PAD.l} x2={W - PAD.r} y1={y(p)} y2={y(p)} />
          <text className="axis" x={PAD.l - 8} y={y(p) + 4} textAnchor="end">
            {p}%
          </text>
        </g>
      ))}
      {[20, 30, 40, 50, 60, 70, 80, 90, 100, 110].map((deg) => (
        <g key={`x${deg}`}>
          <line className="grid-line" x1={x(deg)} x2={x(deg)} y1={PAD.t} y2={H - PAD.b} />
          <text className="axis" x={x(deg)} y={H - PAD.b + 18} textAnchor="middle">
            {deg}°
          </text>
        </g>
      ))}

      {/* live temperature marker */}
      {liveTemp != null && liveTemp >= T_MIN && liveTemp <= T_MAX && (
        <g className="live">
          <line x1={x(liveTemp)} x2={x(liveTemp)} y1={PAD.t} y2={H - PAD.b} />
          <text x={x(liveTemp) + 5} y={PAD.t + 12}>
            {t('fans.now', { temp: Math.round(liveTemp) })}
          </text>
        </g>
      )}

      {dirty && <path className="ghost" d={path(saved)} />}
      <path
        className="area"
        d={`${path(curve)} L${x(curve.temp[7])},${y(0)} L${x(curve.temp[0])},${y(0)} Z`}
      />
      <path className="line" d={path(curve)} />

      {curve.temp.map((temp, i) => {
        const pct = pwmToPercent(curve.pwm[i])
        return (
          <g key={i}>
            <circle
              className={`pt ${active === i ? 'on' : ''}`}
              cx={x(temp)}
              cy={y(pct)}
              r={active === i ? 8 : 6}
              tabIndex={0}
              role="slider"
              aria-label={t('fans.point', { n: i + 1 })}
              aria-valuetext={t('fans.pointValue', { temp, pct })}
              aria-valuenow={pct}
              onPointerDown={(e) => {
                ;(e.target as Element).setPointerCapture(e.pointerId)
                setDrag(i)
              }}
              onFocus={() => setFocus(i)}
              onBlur={() => setFocus(null)}
              onKeyDown={(e) => onKey(i, e)}
            />
            {active === i && (
              <text className="pt-label" x={x(temp)} y={y(pct) - 14} textAnchor="middle">
                {temp}°C · {pct}%
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
