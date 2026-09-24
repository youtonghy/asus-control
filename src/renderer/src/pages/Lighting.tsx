import { useEffect, useState, type ReactNode } from 'react'
import {
  AURA_DIRECTIONS,
  AURA_MODES,
  AURA_SPEEDS,
  auraModeByRepr,
  hexToRgb,
  rgbToHex,
  type AuraDevice,
  type AuraEffect,
  type AuraPowerState
} from '@shared/asus'
import { useStore, useT } from '../store'
import { Button, Card, Row, Segmented, Toggle } from '../ui'

const SWATCHES = ['#ff0033', '#ff7a00', '#ffd400', '#00e676', '#00b8ff', '#3d5afe', '#b000ff', '#ffffff']

export function Lighting(): ReactNode {
  const { snap } = useStore()
  const t = useT()
  if (!snap?.aura.length) {
    return (
      <div className="grid">
        <Card title={t('light.title')} icon="light" className="span-2">
          <p className="muted">{t('light.none')}</p>
        </Card>
      </div>
    )
  }
  return (
    <div className="grid">
      {snap.aura.map((dev) => (
        <AuraCards key={dev.path} dev={dev} multi={snap.aura.length > 1} />
      ))}
    </div>
  )
}

function AuraCards({ dev, multi }: { dev: AuraDevice; multi: boolean }): ReactNode {
  const { act, busy } = useStore()
  const t = useT()
  const suffix = multi ? ` · ${dev.id}` : ''
  const supported = AURA_MODES.filter((m) => dev.supportedModes.includes(m.repr))
  const [draft, setDraft] = useState<AuraEffect | null>(dev.effect)

  // Reset the draft when asusd reports a new effect (e.g. set from the CLI).
  useEffect(() => setDraft(dev.effect), [dev.effect])

  const levels = dev.supportedBrightness.length ? [...dev.supportedBrightness].sort() : [0, 1, 2, 3]
  const def = draft ? auraModeByRepr(draft.mode) : undefined

  const pickMode = (repr: number): void => {
    // Start from what asusd remembers for that mode, so colours are kept per mode.
    const stored = dev.modeData[repr]
    const base = stored ?? draft ?? {
      mode: repr, zone: 0, colour1: [255, 0, 0], colour2: [0, 0, 255], speed: 'Med', direction: 'Right'
    }
    const next = { ...base, mode: repr }
    setDraft(next)
    void act({ type: 'setAuraEffect', path: dev.path, effect: next })
  }

  const apply = (patch: Partial<AuraEffect>): void => {
    if (!draft) return
    const next = { ...draft, ...patch }
    setDraft(next)
    void act({ type: 'setAuraEffect', path: dev.path, effect: next })
  }

  return (
    <>
      <Card title={`${t('light.effect')}${suffix}`} icon="keyboard" className="span-2">
        <div className="mode-grid" role="radiogroup" aria-label={t('light.effectGroup')}>
          {supported.map((m) => (
            <button
              key={m.repr}
              type="button"
              role="radio"
              aria-checked={draft?.mode === m.repr}
              className={`mode-tile ${draft?.mode === m.repr ? 'on' : ''}`}
              onClick={() => draft?.mode !== m.repr && pickMode(m.repr)}
            >
              <span
                className={`mode-preview mode-${m.slug}`}
                style={
                  m.colours && draft
                    ? {
                        ['--c1' as string]: rgbToHex(dev.modeData[m.repr]?.colour1 ?? draft.colour1),
                        ['--c2' as string]: rgbToHex(dev.modeData[m.repr]?.colour2 ?? draft.colour2)
                      }
                    : undefined
                }
              />
              {t.dyn(`aura.mode.${m.slug}`, m.slug)}
            </button>
          ))}
        </div>

        {draft && def && (
          <div className="aura-options">
            {def.colours >= 1 && (
              <ColourRow
                label={def.colours === 2 ? t('light.colour1') : t('light.colour')}
                value={draft.colour1}
                onPick={(c) => apply({ colour1: c })}
              />
            )}
            {def.colours === 2 && (
              <ColourRow label={t('light.colour2')} value={draft.colour2} onPick={(c) => apply({ colour2: c })} />
            )}
            {def.speed && (
              <Row label={t('light.speed')}>
                <Segmented
                  label={t('light.speed')}
                  value={draft.speed}
                  options={AURA_SPEEDS.map((s) => ({ value: s, label: t(`aura.speed.${s}`) }))}
                  onChange={(s) => apply({ speed: s })}
                />
              </Row>
            )}
            {def.direction && (
              <Row label={t('light.direction')}>
                <Segmented
                  label={t('light.direction')}
                  value={draft.direction}
                  options={AURA_DIRECTIONS.map((d) => ({ value: d, label: t(`aura.dir.${d}`) }))}
                  onChange={(d) => apply({ direction: d })}
                />
              </Row>
            )}
          </div>
        )}
      </Card>

      <Card title={`${t('light.brightness')}${suffix}`} icon="light">
        <Segmented
          label={t('kbd.brightness')}
          value={dev.brightness}
          busy={busy.has('setAuraBrightness')}
          options={levels.map((l) => ({ value: l, label: t.dyn(`aura.brightness.${l}`, String(l)) }))}
          onChange={(v) => act({ type: 'setAuraBrightness', path: dev.path, value: v })}
        />
      </Card>

      {dev.power.length > 0 && <PowerStates dev={dev} />}
    </>
  )
}

function ColourRow({
  label,
  value,
  onPick
}: {
  label: string
  value: [number, number, number]
  onPick: (c: [number, number, number]) => void
}): ReactNode {
  const t = useT()
  const hex = rgbToHex(value)
  const [local, setLocal] = useState(hex)
  useEffect(() => setLocal(hex), [hex])
  return (
    <Row label={label}>
      <div className="swatches">
        {SWATCHES.map((s) => (
          <button
            key={s}
            type="button"
            className={`swatch-btn ${s === hex ? 'on' : ''}`}
            style={{ background: s }}
            aria-label={t('light.colourN', { hex: s })}
            onClick={() => onPick(hexToRgb(s))}
          />
        ))}
        <label className="colour-input" title={t('light.customColour')}>
          <input
            type="color"
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            // Commit when the native picker closes to avoid flooding asusd.
            onBlur={() => local !== hex && onPick(hexToRgb(local))}
          />
          <span>{local}</span>
        </label>
      </div>
    </Row>
  )
}

const POWER_STATES = ['boot', 'awake', 'sleep', 'shutdown'] as const

function PowerStates({ dev }: { dev: AuraDevice }): ReactNode {
  const { act, busy } = useStore()
  const t = useT()
  const [states, setStates] = useState<AuraPowerState[]>(dev.power)
  useEffect(() => setStates(dev.power), [dev.power])
  const dirty = JSON.stringify(states) !== JSON.stringify(dev.power)
  const zoneName = (z: number): string => t.dyn(`aura.zone.${z}`, t('light.zoneN', { n: z }))
  return (
    <Card
      title={t('light.power')}
      icon="plug"
      actions={
        <Button
          kind="primary"
          disabled={!dirty || busy.has('setAuraPower')}
          onClick={() => act({ type: 'setAuraPower', path: dev.path, power: states }, t('light.saved'))}
        >
          {t('light.save')}
        </Button>
      }
    >
      <table className="power-table">
        <thead>
          <tr>
            <th scope="col">{t('light.zone')}</th>
            {POWER_STATES.map((c) => (
              <th key={c} scope="col">
                {t(`light.state.${c}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {states.map((s, i) => (
            <tr key={s.zone}>
              <th scope="row">{zoneName(s.zone)}</th>
              {POWER_STATES.map((c) => (
                <td key={c}>
                  <Toggle
                    label={`${zoneName(s.zone)} ${t(`light.state.${c}`)}`}
                    checked={s[c]}
                    onChange={(v) => setStates((st) => st.map((x, j) => (j === i ? { ...x, [c]: v } : x)))}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}
