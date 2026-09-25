import type { ReactNode } from 'react'
import { ANIME_BUILTINS, SLASH_MODES, type AnimeBuiltins, type AnimeProp, type AnimeState, type SlashProp, type SlashState } from '@shared/asus'
import { useStore, useT } from '../store'
import { Card, Note, Row, Segmented, Slider, Toggle } from '../ui'

/** The lid display page: AniMe Matrix or Slash lightbar, whichever asusd reports. */
export function Matrix(): ReactNode {
  const { snap } = useStore()
  return (
    <div className="grid">
      {snap?.anime && <AnimeCards anime={snap.anime} />}
      {snap?.slash && <SlashCards slash={snap.slash} />}
    </div>
  )
}

const STATES = ['boot', 'awake', 'sleep', 'shutdown'] as const

function AnimeCards({ anime: a }: { anime: AnimeState }): ReactNode {
  const { act, busy } = useStore()
  const t = useT()
  const set = (prop: AnimeProp, value: boolean | number | AnimeBuiltins): void =>
    void act({ type: 'setAnime', prop, value })
  const isBusy = busy.has('setAnime')
  return (
    <>
      <Card title={t('anime.title')} icon="matrix" className="span-2">
        <Row label={t('anime.display')} hint={t('anime.displayHint')}>
          <Toggle
            label={t('anime.display')}
            checked={a.displayEnabled}
            disabled={isBusy}
            onChange={(v) => set('EnableDisplay', v)}
          />
        </Row>
        <Row label={t('anime.brightness')}>
          <Segmented
            label={t('anime.brightness')}
            value={a.brightness}
            busy={isBusy}
            disabled={!a.displayEnabled}
            options={[0, 1, 2, 3].map((l) => ({ value: l, label: t.dyn(`aura.brightness.${l}`, String(l)) }))}
            onChange={(v) => set('Brightness', v)}
          />
        </Row>
      </Card>

      <Card title={t('anime.builtins')} icon="light">
        <Row label={t('anime.builtins')} hint={t('anime.builtinsHint')}>
          <Toggle
            label={t('anime.builtins')}
            checked={a.builtinsEnabled}
            disabled={isBusy}
            onChange={(v) => set('BuiltinsEnabled', v)}
          />
        </Row>
        {a.builtinsEnabled ? (
          STATES.map((s) => (
            <Row key={s} label={t(`light.state.${s}`)}>
              <Segmented
                label={t(`light.state.${s}`)}
                value={a.builtins[s]}
                busy={isBusy}
                options={ANIME_BUILTINS[s].map((id) => ({ value: id, label: t.dyn(`anime.anim.${id}`, id) }))}
                onChange={(id) => set('BuiltinAnimations', { ...a.builtins, [s]: id })}
              />
            </Row>
          ))
        ) : (
          <p className="muted small">{t('anime.builtinsOff')}</p>
        )}
      </Card>

      <Card title={t('anime.autoOff')} icon="plug">
        {(
          [
            ['OffWhenUnplugged', 'offWhenUnplugged', 'anime.offUnplugged'],
            ['OffWhenSuspended', 'offWhenSuspended', 'anime.offSuspended'],
            ['OffWhenLidClosed', 'offWhenLidClosed', 'anime.offLidClosed']
          ] as const
        ).map(([prop, key, label]) => (
          <Row key={prop} label={t(label)}>
            <Toggle label={t(label)} checked={a[key]} disabled={isBusy} onChange={(v) => set(prop, v)} />
          </Row>
        ))}
      </Card>
    </>
  )
}

const SLASH_WHEN = [
  ['ShowOnBoot', 'showOnBoot', 'slash.showOnBoot'],
  ['ShowOnShutdown', 'showOnShutdown', 'slash.showOnShutdown'],
  ['ShowOnSleep', 'showOnSleep', 'slash.showOnSleep'],
  ['ShowOnBattery', 'showOnBattery', 'slash.showOnBattery'],
  ['ShowOnLidClosed', 'showOnLidClosed', 'slash.showOnLidClosed'],
  ['ShowBatteryWarning', 'showBatteryWarning', 'slash.showBatteryWarning']
] as const

function SlashCards({ slash: s }: { slash: SlashState }): ReactNode {
  const { act, busy } = useStore()
  const t = useT()
  const set = (prop: SlashProp, value: boolean | number): void => void act({ type: 'setSlash', prop, value })
  const isBusy = busy.has('setSlash')
  const known = SLASH_MODES.some((m) => m.id === s.mode)
  return (
    <>
      <Card title={t('slash.title')} icon="matrix" className="span-2">
        <Row label={t('slash.enabled')} hint={t('slash.enabledHint')}>
          <Toggle label={t('slash.enabled')} checked={s.enabled} disabled={isBusy} onChange={(v) => set('Enabled', v)} />
        </Row>
        <Row label={t('slash.brightness')}>
          <Slider
            label={t('slash.brightness')}
            value={s.brightness}
            min={0}
            max={255}
            disabled={!s.enabled}
            onCommit={(v) => set('Brightness', v)}
          />
        </Row>
        <Row label={t('slash.interval')}>
          <Segmented
            label={t('slash.interval')}
            value={s.interval}
            busy={isBusy}
            disabled={!s.enabled}
            options={[0, 1, 2, 3, 4, 5].map((v) => ({ value: v, label: String(v) }))}
            onChange={(v) => set('Interval', v)}
          />
        </Row>
      </Card>

      <Card title={t('slash.mode')} icon="light" className="span-2">
        <div className="mode-grid" role="radiogroup" aria-label={t('slash.mode')}>
          {SLASH_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={s.mode === m.id}
              className={`mode-tile ${s.mode === m.id ? 'on' : ''}`}
              disabled={!s.enabled}
              onClick={() => s.mode !== m.id && set('Mode', m.id)}
            >
              <span className={`slash-preview slash-${m.slug}`} />
              {t.dyn(`slash.mode.${m.slug}`, m.slug)}
            </button>
          ))}
        </div>
        {!known && <Note>{`Mode 0x${s.mode.toString(16)}`}</Note>}
      </Card>

      <Card title={t('slash.when')} icon="plug" className="span-2">
        <div className="toggle-grid">
          {SLASH_WHEN.map(([prop, key, label]) => (
            <Row key={prop} label={t(label)}>
              <Toggle label={t(label)} checked={s[key]} disabled={isBusy} onChange={(v) => set(prop, v)} />
            </Row>
          ))}
        </div>
      </Card>
    </>
  )
}
