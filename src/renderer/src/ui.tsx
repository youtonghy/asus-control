import { useEffect, useId, useState, type ReactNode } from 'react'

// ---------------------------------------------------------------- Icons

const ICONS: Record<string, ReactNode> = {
  leaf: <path d="M5 19c6 0 14-4 14-15C9 4 5 9 5 14v5Zm0 0 7-7" />,
  scale: <path d="M12 4v16M5 20h14M6 8h12M6 8l-3 6a3 3 0 0 0 6 0L6 8Zm12 0-3 6a3 3 0 0 0 6 0l-3-6Z" />,
  flame: <path d="M12 21a6 6 0 0 0 6-6c0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-2 2-3 5-3 8a6 6 0 0 0 6 6Z" />,
  bolt: <path d="M13 3 5 14h6l-1 7 8-11h-6l1-7Z" />,
  chip: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
    </>
  ),
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
    </>
  ),
  battery: (
    <>
      <rect x="2" y="7" width="17" height="10" rx="2" />
      <path d="M22 11v2" />
    </>
  ),
  fan: (
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M12 10c0-4 1-7 4-7 2 0 3 2 2 4l-4 3M14 12c4 0 7 1 7 4 0 2-2 3-4 2l-3-4M12 14c0 4-1 7-4 7-2 0-3-2-2-4l4-3M10 12c-4 0-7-1-7-4 0-2 2-3 4-2l3 4" />
    </>
  ),
  cog: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </>
  ),
  home: <path d="M3 11 12 4l9 7M5 10v10h14V10" />,
  light: <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3Z" />,
  thermo: <path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0Z" />,
  plug: <path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v5" />,
  reset: <path d="M4 4v6h6M4.5 15a8 8 0 1 0 1.9-8.3L4 10" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.01" />
    </>
  ),
  warn: <path d="M12 3 2 20h20L12 3Zm0 6v5m0 3v.01" />
}

export function Icon({ name, size = 18 }: { name: string; size?: number }): ReactNode {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  )
}

// ---------------------------------------------------------------- Layout

export function Card({
  title,
  icon,
  actions,
  children,
  className = ''
}: {
  title: string
  icon?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}): ReactNode {
  return (
    <section className={`card ${className}`}>
      <header className="card-head">
        <h2>
          {icon && <Icon name={icon} />}
          {title}
        </h2>
        {actions && <div className="card-actions">{actions}</div>}
      </header>
      {children}
    </section>
  )
}

export function Note({ kind = 'info', children }: { kind?: 'info' | 'warn'; children: ReactNode }): ReactNode {
  return (
    <p className={`note note-${kind}`}>
      <Icon name={kind === 'warn' ? 'warn' : 'info'} size={15} />
      <span>{children}</span>
    </p>
  )
}

export function Row({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }): ReactNode {
  return (
    <div className="row">
      <div className="row-label">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="row-control">{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------- Controls

export interface SegOption<T> {
  value: T
  label: ReactNode
  hint?: string
  icon?: string
  tone?: string
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  busy,
  disabled,
  large,
  label
}: {
  options: SegOption<T>[]
  value: T | undefined
  onChange: (v: T) => void
  busy?: boolean
  disabled?: boolean
  large?: boolean
  label: string
}): ReactNode {
  return (
    <div className={`seg ${large ? 'seg-large' : ''} ${busy ? 'is-busy' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'on' : ''}
          data-tone={o.tone}
          disabled={disabled}
          title={o.hint}
          onClick={() => o.value !== value && onChange(o.value)}
        >
          {o.icon && <Icon name={o.icon} size={large ? 22 : 16} />}
          <span className="seg-label">{o.label}</span>
          {large && o.hint && <small>{o.hint}</small>}
        </button>
      ))}
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  disabled,
  label
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  label: string
}): ReactNode {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle ${checked ? 'on' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  )
}

/** Range slider that previews locally while dragging and commits on release. */
export function Slider({
  value,
  min,
  max,
  step = 1,
  unit = '',
  onCommit,
  disabled,
  label,
  marks
}: {
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  onCommit: (v: number) => void
  disabled?: boolean
  label: string
  marks?: number[]
}): ReactNode {
  const [local, setLocal] = useState(value)
  const [dragging, setDragging] = useState(false)
  const id = useId()
  useEffect(() => {
    if (!dragging) setLocal(value)
  }, [value, dragging])
  const commit = (): void => {
    setDragging(false)
    if (local !== value) onCommit(local)
  }
  const pct = ((local - min) / (max - min || 1)) * 100
  return (
    <div className="slider">
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        disabled={disabled}
        aria-label={label}
        list={marks ? `${id}-marks` : undefined}
        style={{ ['--pct' as string]: `${pct}%` }}
        onChange={(e) => {
          setDragging(true)
          setLocal(Number(e.target.value))
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={() => dragging && commit()}
      />
      {marks && (
        <datalist id={`${id}-marks`}>
          {marks.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      )}
      <output htmlFor={id}>
        {local}
        {unit}
      </output>
    </div>
  )
}

export function Button({
  children,
  onClick,
  kind = 'ghost',
  disabled,
  icon,
  title
}: {
  children: ReactNode
  onClick: () => void
  kind?: 'primary' | 'ghost' | 'danger'
  disabled?: boolean
  icon?: string
  title?: string
}): ReactNode {
  return (
    <button type="button" className={`btn btn-${kind}`} onClick={onClick} disabled={disabled} title={title}>
      {icon && <Icon name={icon} size={15} />}
      {children}
    </button>
  )
}

export function Stat({
  icon,
  label,
  value,
  unit,
  tone
}: {
  icon: string
  label: string
  value: ReactNode
  unit?: string
  tone?: 'ok' | 'warm' | 'hot'
}): ReactNode {
  return (
    <div className="stat" data-tone={tone}>
      <Icon name={icon} size={16} />
      <div>
        <small>{label}</small>
        <strong>
          {value}
          {unit && <em>{unit}</em>}
        </strong>
      </div>
    </div>
  )
}

export const tempTone = (t: number | null): 'ok' | 'warm' | 'hot' | undefined =>
  t === null ? undefined : t >= 85 ? 'hot' : t >= 70 ? 'warm' : 'ok'
