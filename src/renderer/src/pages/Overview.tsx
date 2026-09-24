import type { ReactNode } from 'react'
import { auraModeByRepr, availableGpuModes, gpuModeFrom, rgbToHex, sortProfiles, type GpuMode } from '@shared/asus'
import { profileHint, profileName } from '@shared/i18n'
import { rich, useArmoury, useStore, useT } from '../store'
import { Card, Note, Row, Segmented, Slider, Toggle } from '../ui'

const PROFILE_ICON: Record<number, string> = { 0: 'scale', 1: 'flame', 2: 'leaf', 3: 'leaf', 4: 'cog' }
const PROFILE_TONE: Record<number, string> = { 0: 'balanced', 1: 'turbo', 2: 'silent', 3: 'silent', 4: 'balanced' }
const GPU_ICON: Record<GpuMode, string> = { integrated: 'leaf', hybrid: 'scale', ultimate: 'bolt' }

export function Overview(): ReactNode {
  return (
    <div className="grid">
      <PerformanceCard />
      <GpuCard />
      <ScreenCard />
      <KeyboardCard />
      <BatteryQuickCard />
    </div>
  )
}

function PerformanceCard(): ReactNode {
  const { snap, act, busy } = useStore()
  const t = useT()
  const p = snap?.platform
  if (!p) return null
  return (
    <Card title={t('perf.title')} icon="bolt" className="span-2">
      <Segmented
        large
        label={t('perf.title')}
        value={p.profile}
        busy={busy.has('platform:PlatformProfile')}
        options={sortProfiles(p.choices).map((c) => ({
          value: c,
          label: profileName(t, c),
          hint: profileHint(t, c),
          icon: PROFILE_ICON[c],
          tone: PROFILE_TONE[c]
        }))}
        onChange={(v) => act({ type: 'setPlatform', prop: 'PlatformProfile', value: v })}
      />
      <p className="muted small">{t('perf.fnHint')}</p>
    </Card>
  )
}

function GpuCard(): ReactNode {
  const { act, busy } = useStore()
  const t = useT()
  const dgpu = useArmoury('dgpu_disable')
  const mux = useArmoury('gpu_mux_mode')
  if (!dgpu && !mux) return null

  const current = gpuModeFrom(dgpu?.current, mux?.current)
  // Values written to GPU attributes are queued until shutdown.
  const queuedDgpu = dgpu && dgpu.queued >= 0 ? dgpu.queued : dgpu?.current
  const queuedMux = mux && mux.queued >= 0 ? mux.queued : mux?.current
  const pending = gpuModeFrom(queuedDgpu, queuedMux)
  const modes = availableGpuModes(!!dgpu, !!mux)

  return (
    <Card title={t('gpu.title')} icon="chip" className="span-2">
      <Segmented
        large
        label={t('gpu.title')}
        value={pending}
        busy={busy.has('setGpuMode')}
        options={modes.map((m) => ({
          value: m,
          label: t(`gpu.${m}`),
          hint: t(`gpu.${m}.hint`),
          icon: GPU_ICON[m],
          tone: m === 'integrated' ? 'silent' : m === 'ultimate' ? 'turbo' : 'balanced'
        }))}
        onChange={(m) => act({ type: 'setGpuMode', mode: m }, t('gpu.scheduled', { mode: t(`gpu.${m}`) }))}
      />
      {pending !== current ? (
        <Note kind="warn">
          {rich(t, 'gpu.pending', { from: <b>{t(`gpu.${current}`)}</b>, to: <b>{t(`gpu.${pending}`)}</b> })}
        </Note>
      ) : (
        <p className="muted small">{t('gpu.rebootNote')}</p>
      )}
    </Card>
  )
}

function ScreenCard(): ReactNode {
  const { display, act, busy, refreshDisplay } = useStore()
  const t = useT()
  const overdrive = useArmoury('panel_overdrive')
  const hasRates = display && display.backend !== 'none' && display.rates.length > 1
  if (!hasRates && !overdrive) return null
  return (
    <Card title={t('screen.title')} icon="monitor">
      {hasRates && (
        <Row label={t('screen.refresh')} hint={display.output ?? undefined}>
          <Segmented
            label={t('screen.refresh')}
            value={display.currentModeId ?? undefined}
            busy={busy.has('setDisplayMode')}
            options={display.rates.map((r) => ({ value: r.id, label: t('screen.hz', { rate: Math.round(r.refresh) }) }))}
            onChange={async (id) => {
              await act({ type: 'setDisplayMode', modeId: id })
              await refreshDisplay()
            }}
          />
        </Row>
      )}
      {overdrive && (
        <Row label={t('screen.overdrive')} hint={t('screen.overdriveHint')}>
          <Toggle
            label={t('screen.overdrive')}
            checked={overdrive.current === 1}
            disabled={busy.has('armoury:panel_overdrive')}
            onChange={(v) => act({ type: 'setArmoury', id: 'panel_overdrive', value: v ? 1 : 0 })}
          />
        </Row>
      )}
      {!hasRates && display?.backend === 'none' && <p className="muted small">{t('screen.kdeOnly')}</p>}
    </Card>
  )
}

function KeyboardCard(): ReactNode {
  const { snap, act, busy } = useStore()
  const t = useT()
  const dev = snap?.aura[0]
  if (!dev) return null
  const levels = dev.supportedBrightness.length ? dev.supportedBrightness : [0, 1, 2, 3]
  const mode = dev.effect ? auraModeByRepr(dev.effect.mode) : undefined
  return (
    <Card title={t('kbd.title')} icon="keyboard">
      <Row label={t('kbd.backlight')}>
        <Segmented
          label={t('kbd.brightness')}
          value={dev.brightness}
          busy={busy.has('setAuraBrightness')}
          options={[...levels].sort().map((l) => ({ value: l, label: t.dyn(`aura.brightness.${l}`, String(l)) }))}
          onChange={(v) => act({ type: 'setAuraBrightness', path: dev.path, value: v })}
        />
      </Row>
      {dev.effect && (
        <Row label={t('kbd.effect')} hint={t('kbd.effectHint')}>
          <span className="chip">
            {mode?.colours ? (
              <span className="swatch" style={{ background: rgbToHex(dev.effect.colour1) }} />
            ) : (
              <span className="swatch swatch-rainbow" />
            )}
            {mode ? t.dyn(`aura.mode.${mode.slug}`, mode.slug) : t('kbd.modeN', { n: dev.effect.mode })}
          </span>
        </Row>
      )}
    </Card>
  )
}

function BatteryQuickCard(): ReactNode {
  const { snap, act, busy, sensors } = useStore()
  const t = useT()
  const limit = snap?.platform?.chargeLimit
  if (limit == null) return null
  const b = sensors?.battery
  return (
    <Card title={t('battery.title')} icon="battery">
      <Row label={t('battery.limit')} hint={t('battery.limitHint')}>
        <Segmented
          label={t('battery.presets')}
          value={[60, 80, 100].includes(limit) ? limit : undefined}
          busy={busy.has('platform:ChargeControlEndThreshold')}
          options={[60, 80, 100].map((v) => ({ value: v, label: `${v}%` }))}
          onChange={(v) => act({ type: 'setPlatform', prop: 'ChargeControlEndThreshold', value: v })}
        />
      </Row>
      <Slider
        label={t('battery.limit')}
        value={limit}
        min={20}
        max={100}
        unit="%"
        onCommit={(v) => act({ type: 'setPlatform', prop: 'ChargeControlEndThreshold', value: v })}
      />
      {b && (
        <p className="muted small">
          {t(b.health != null ? 'battery.summaryHealth' : 'battery.summary', {
            percent: b.percent,
            status: t.dyn(`batt.state.${b.status}`, b.status),
            health: b.health ?? ''
          })}
        </p>
      )}
    </Card>
  )
}
