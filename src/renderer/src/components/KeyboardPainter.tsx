import { useEffect, useState, type ReactNode } from 'react'
import { hexToRgb, rgbToHex, type AuraAdvanced, type Rgb } from '@shared/asus'
import { PER_KEY_CODES, isAddressable, keyCap } from '@shared/aura-advanced'
import { useStore, useT } from '../store'
import { Button, Card, Note } from '../ui'

const SWATCHES = ['#ff0033', '#ff7a00', '#ffd400', '#00e676', '#00b8ff', '#3d5afe', '#b000ff', '#ffffff', '#000000']
/** Pixels per key unit (a regular key is 1.0 wide). */
const UNIT = 40

/** Paint per-key or per-zone colours and send them with DirectAddressingRaw. */
export function KeyboardPainter({ adv }: { adv: AuraAdvanced }): ReactNode {
  const { act, busy, settings } = useStore()
  const t = useT()
  const [colours, setColours] = useState<Record<string, Rgb>>(settings?.customLighting ?? {})
  const [brush, setBrush] = useState('#00b8ff')
  const [painting, setPainting] = useState(false)

  useEffect(() => {
    const stop = (): void => setPainting(false)
    window.addEventListener('pointerup', stop)
    return () => window.removeEventListener('pointerup', stop)
  }, [])

  const layout = adv.kind === 'per-key' ? adv.layout : null
  const targets =
    adv.kind === 'zoned'
      ? adv.zones
      : layout
        ? [...new Set(layout.keys.map((k) => k.code).filter(isAddressable))]
        : PER_KEY_CODES
  const paint = (code: string): void => setColours((c) => ({ ...c, [code]: hexToRgb(brush) }))
  const dirty = JSON.stringify(colours) !== JSON.stringify(settings?.customLighting ?? {})

  return (
    <Card
      title={adv.kind === 'zoned' ? t('perkey.zonesTitle') : t('perkey.title')}
      icon="keyboard"
      className="span-2"
      actions={
        <>
          <Button onClick={() => setColours(Object.fromEntries(targets.map((c) => [c, hexToRgb(brush)])))}>
            {t('perkey.fill')}
          </Button>
          <Button onClick={() => setColours({})}>{t('perkey.clear')}</Button>
          <Button
            kind="primary"
            disabled={busy.has('setAuraDirect') || (!dirty && !!settings?.customLightingActive)}
            onClick={() => act({ type: 'setAuraDirect', path: adv.path, colours }, t('perkey.applied'))}
          >
            {t('perkey.apply')}
          </Button>
        </>
      }
    >
      <div className="swatches" role="radiogroup" aria-label={t('perkey.brush')}>
        {SWATCHES.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={s === brush}
            className={`swatch-btn ${s === brush ? 'on' : ''}`}
            style={{ background: s }}
            aria-label={t('light.colourN', { hex: s })}
            onClick={() => setBrush(s)}
          />
        ))}
        <label className="colour-input" title={t('light.customColour')}>
          <input type="color" value={brush} onChange={(e) => setBrush(e.target.value)} />
          <span>{brush}</span>
        </label>
      </div>
      <p className="muted small">{t('perkey.hint')}</p>

      {adv.kind === 'zoned' && (
        <div className="zone-list">
          {adv.zones.map((z) => (
            <button key={z} type="button" className="zone-btn" onClick={() => paint(z)}>
              <span className="swatch" style={{ background: colours[z] ? rgbToHex(colours[z]) : 'transparent' }} />
              {t.dyn(`zone.${z}`, z)}
            </button>
          ))}
        </div>
      )}

      {layout && (
        <div className="keyboard-scroll">
          <svg
            className="keyboard"
            width={layout.width * UNIT}
            height={layout.height * UNIT}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            onPointerLeave={() => setPainting(false)}
          >
            {layout.keys.map((k, i) => {
              const ok = isAddressable(k.code)
              const c = colours[k.code]
              const label = keyCap(k.code) || k.code
              return (
                <g
                  key={`${k.code}-${i}`}
                  className={`key ${ok ? '' : 'key-fixed'}`}
                  role={ok ? 'button' : undefined}
                  tabIndex={ok ? 0 : undefined}
                  aria-label={t('perkey.key', { key: label })}
                  onPointerDown={(e) => {
                    if (!ok) return
                    e.preventDefault()
                    setPainting(true)
                    paint(k.code)
                  }}
                  onPointerEnter={() => ok && painting && paint(k.code)}
                  onKeyDown={(e) => {
                    if (ok && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault()
                      paint(k.code)
                    }
                  }}
                >
                  <title>{ok ? label : `${label} — ${t('perkey.fixed')}`}</title>
                  <rect
                    x={k.x}
                    y={k.y}
                    width={k.w}
                    height={k.h}
                    rx={Math.min(0.12, k.h / 3)}
                    style={c ? { fill: rgbToHex(c) } : undefined}
                  />
                  {k.h >= 0.6 && k.w >= 0.6 && keyCap(k.code) && (
                    <text
                      x={k.x + k.w / 2}
                      y={k.y + k.h / 2}
                      textAnchor="middle"
                      dominantBaseline="central"
                      className={c && lum(c) > 0.55 ? 'on-light' : ''}
                    >
                      {keyCap(k.code)}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
        </div>
      )}

      {adv.kind === 'per-key' && !layout && <Note>{t('perkey.noLayout', { name: adv.layoutName })}</Note>}
      {settings?.customLightingActive && <Note>{t('perkey.active')}</Note>}
    </Card>
  )
}

/** Relative luminance, to keep key captions readable on bright colours. */
function lum([r, g, b]: Rgb): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}
