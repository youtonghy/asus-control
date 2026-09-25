import { useEffect, useState, type ReactNode } from 'react'
import {
  HOTKEY_ACTIONS,
  PPT_ATTRS,
  PlatformProfile,
  armouryMeta,
  isRangeAttr,
  type AppSettings,
  type ArmouryAttr,
  type HotkeyState,
  type PlatformProp
} from '@shared/asus'
import { LOCALES, attrDescription, attrLabel, attrValue, profileName, resolveLocale } from '@shared/i18n'
import { rich, useStore, useT } from '../store'
import { Button, Card, Note, Row, Segmented, Slider, Toggle } from '../ui'

const EPP_ROWS: { prop: PlatformProp; key: 'quiet' | 'balanced' | 'performance'; profile: number }[] = [
  { prop: 'ProfileQuietEpp', key: 'quiet', profile: PlatformProfile.Quiet },
  { prop: 'ProfileBalancedEpp', key: 'balanced', profile: PlatformProfile.Balanced },
  { prop: 'ProfilePerformanceEpp', key: 'performance', profile: PlatformProfile.Performance }
]
const EPP_VALUES = [0, 1, 2, 3, 4]

export function System(): ReactNode {
  const { snap, act, busy } = useStore()
  const t = useT()
  const p = snap?.platform
  // Everything not owned by a dedicated card (GPU / PPT / panel overdrive on Overview).
  const attrs = snap?.armoury.filter((a) => !armouryMeta(a.id).dedicated && !PPT_ATTRS.has(a.id)) ?? []

  return (
    <div className="grid">
      {p && (
        <Card title={t('epp.title')} icon="chip" className="span-2">
          <Row label={t('epp.link')} hint={t('epp.linkHint')}>
            <Toggle
              label={t('epp.link')}
              checked={p.linkedEpp}
              disabled={busy.has('platform:PlatformProfileLinkedEpp')}
              onChange={(v) => act({ type: 'setPlatform', prop: 'PlatformProfileLinkedEpp', value: v })}
            />
          </Row>
          {p.linkedEpp &&
            EPP_ROWS.filter((r) => p.choices.includes(r.profile)).map((r) => (
              <Row key={r.prop} label={profileName(t, r.profile)}>
                <Segmented
                  label={t('epp.for', { mode: profileName(t, r.profile) })}
                  value={p.epp[r.key]}
                  busy={busy.has(`platform:${r.prop}`)}
                  options={EPP_VALUES.map((v) => ({
                    value: v,
                    label: t.dyn(`epp.short.${v}`, String(v)),
                    hint: t.dyn(`epp.${v}`, String(v))
                  }))}
                  onChange={(v) => act({ type: 'setPlatform', prop: r.prop, value: v })}
                />
              </Row>
            ))}
        </Card>
      )}

      {attrs.length > 0 && (
        <Card title={t('fw.title')} icon="cog" className="span-2">
          {attrs.map((a) => (
            <AttrRow key={a.id} attr={a} />
          ))}
        </Card>
      )}

      <AppSettingsCard />
      <HotkeysCard />
      <AboutCard />
    </div>
  )
}

function AttrRow({ attr: a }: { attr: ArmouryAttr }): ReactNode {
  const { act, busy } = useStore()
  const t = useT()
  const m = armouryMeta(a.id)
  const label = attrLabel(t, a.id, a.displayName)
  const isBusy = busy.has(`armoury:${a.id}`)
  const set = (v: number): void => void act({ type: 'setArmoury', id: a.id, value: v })
  let control: ReactNode
  if (m.readOnly) {
    control = <span className="chip">{attrValue(t, a.id, a.current)}</span>
  } else if (isRangeAttr(a)) {
    control = (
      <Slider
        label={label}
        value={a.current}
        min={a.min}
        max={a.max}
        step={a.step > 0 ? a.step : 1}
        unit={m.unit ? ` ${m.unit}` : ''}
        disabled={isBusy}
        onCommit={set}
      />
    )
  } else if (a.possible.length === 2 && a.possible.includes(0) && a.possible.includes(1)) {
    control = <Toggle label={label} checked={a.current === 1} disabled={isBusy} onChange={(v) => set(v ? 1 : 0)} />
  } else {
    control = (
      <Segmented
        label={label}
        value={a.current}
        busy={isBusy}
        options={a.possible.map((v) => ({ value: v, label: attrValue(t, a.id, v) }))}
        onChange={set}
      />
    )
  }
  return (
    <Row label={label} hint={attrDescription(t, a.id, a.displayName)}>
      {control}
    </Row>
  )
}

function AppSettingsCard(): ReactNode {
  const { settings: s, updateSettings } = useStore()
  const t = useT()
  if (!s) return null
  const systemLocale = LOCALES.find((l) => l.id === resolveLocale('system', navigator.language))!
  return (
    <Card title={t('settings.title')} icon="cog">
      <Row label={t('settings.language')} hint={t('settings.languageHint')}>
        <select
          className="select"
          aria-label={t('settings.language')}
          value={s.language}
          onChange={(e) => void updateSettings({ language: e.target.value as AppSettings['language'] })}
        >
          <option value="system">{t('settings.systemLanguage', { name: systemLocale.name })}</option>
          {LOCALES.map((l) => (
            // Native names, so people can find their language whatever the current one is.
            <option key={l.id} value={l.id} lang={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t('settings.closeToTray')} hint={t('settings.closeToTrayHint')}>
        <Toggle
          label={t('settings.closeToTray')}
          checked={s.closeToTray}
          onChange={(v) => void updateSettings({ closeToTray: v })}
        />
      </Row>
      <Row label={t('settings.startHidden')} hint={t('settings.startHiddenHint')}>
        <Toggle
          label={t('settings.startHidden')}
          checked={s.startHidden}
          onChange={(v) => void updateSettings({ startHidden: v })}
        />
      </Row>
      <Row label={t('settings.autostart')} hint={t('settings.autostartHint')}>
        <Toggle
          label={t('settings.autostart')}
          checked={s.autostart}
          onChange={(v) => void updateSettings({ autostart: v })}
        />
      </Row>
    </Card>
  )
}

function HotkeysCard(): ReactNode {
  const { snap, display, settings, updateSettings, toast } = useStore()
  const t = useT()
  const [state, setState] = useState<HotkeyState | null>(null)
  useEffect(() => {
    void window.asus.hotkeys().then(setState)
    return window.asus.onHotkeys(setState)
  }, [])
  if (!settings || !state) return null
  // Only offer actions this laptop and desktop can do (the portal still gets all of them).
  const kbd = snap?.aura[0]
  const available = HOTKEY_ACTIONS.filter((a) => {
    if (a === 'cycle-kbd-brightness') return !!kbd
    if (a === 'cycle-aura-mode') return !!kbd?.effect && kbd.supportedModes.length > 1
    if (a === 'toggle-refresh') return (display?.rates.length ?? 0) > 1
    if (a === 'toggle-matrix') return !!(snap?.anime || snap?.slash)
    return true
  })
  const trigger = (id: string): string => state.bindings.find((b) => b.id === id)?.trigger || t('hotkeys.unassigned')
  const fail = (e: unknown): void =>
    toast({ kind: 'error', text: t('error.failed', { message: e instanceof Error ? e.message : String(e) }) })
  return (
    <Card
      title={t('hotkeys.title')}
      icon="keyboard"
      actions={
        state.status === 'listening' && state.version >= 2 ? (
          <Button onClick={() => void window.asus.configureHotkeys().catch(fail)}>{t('hotkeys.configure')}</Button>
        ) : undefined
      }
    >
      <Row label={t('hotkeys.enable')} hint={t('hotkeys.enableHint')}>
        <Toggle
          label={t('hotkeys.enable')}
          checked={settings.hotkeys}
          onChange={(v) => void updateSettings({ hotkeys: v })}
        />
      </Row>
      {state.status === 'starting' && <p className="muted small">{t('hotkeys.starting')}</p>}
      {state.status === 'unavailable' && <Note kind="warn">{t('hotkeys.unavailable', { error: state.error ?? '' })}</Note>}
      {available.map((a) => (
        <Row key={a} label={t(`hotkey.${a}`)} hint={state.status === 'listening' ? trigger(a) : undefined}>
          <Button onClick={() => void window.asus.runHotkey(a).catch(fail)}>{t('hotkeys.run')}</Button>
        </Row>
      ))}
      <p className="muted small">
        {rich(t, 'hotkeys.cli', {
          cmd: <code>asus-control --action=cycle-profile</code>,
          actions: available.join(', ')
        })}
      </p>
    </Card>
  )
}

function AboutCard(): ReactNode {
  const { snap, refreshDisplay } = useStore()
  const t = useT()
  const [info, setInfo] = useState<{ version: string; electron: string; desktop: string } | null>(null)
  useEffect(() => {
    void window.asus.info().then(setInfo)
  }, [])
  const link = (url: string, text: string): ReactNode => (
    <a href="#" onClick={() => window.asus.openExternal(url)}>
      {text}
    </a>
  )
  return (
    <Card title={t('about.title')} icon="info">
      <Row label={t('about.laptop')}>{snap?.product ?? '–'}</Row>
      <Row label="asusd">{snap?.platform?.version ?? '–'}</Row>
      <Row label={t('about.app')}>
        {info ? `${info.version} · Electron ${info.electron} · ${info.desktop || t('about.unknownDesktop')}` : '–'}
      </Row>
      <p className="muted small">
        {rich(t, 'about.credits', {
          asusctl: link('https://github.com/OpenGamingCollective/asusctl', 'asusctl'),
          ghelper: link('https://github.com/seerge/g-helper', 'G-Helper')
        })}
      </p>
      <Button
        icon="reset"
        onClick={async () => {
          await window.asus.refresh()
          await refreshDisplay()
        }}
      >
        {t('about.reload')}
      </Button>
    </Card>
  )
}
