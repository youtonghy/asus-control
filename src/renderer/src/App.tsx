import { useState, type ReactNode } from 'react'
import type { MessageKey } from '@shared/i18n'
import { profileName } from '@shared/i18n'
import { rich, useStore, useT } from './store'
import { Icon, Stat, tempTone } from './ui'
import { Overview } from './pages/Overview'
import { FansPower } from './pages/FansPower'
import { Lighting } from './pages/Lighting'
import { Battery } from './pages/Battery'
import { System } from './pages/System'

const PAGES: { id: string; label: MessageKey; icon: string; el: () => ReactNode }[] = [
  { id: 'overview', label: 'nav.overview', icon: 'home', el: Overview },
  { id: 'fans', label: 'nav.fans', icon: 'fan', el: FansPower },
  { id: 'lighting', label: 'nav.lighting', icon: 'light', el: Lighting },
  { id: 'battery', label: 'nav.battery', icon: 'battery', el: Battery },
  { id: 'system', label: 'nav.system', icon: 'cog', el: System }
]

/** Accent colour follows the active performance mode, like G-Helper. */
const PROFILE_TONE: Record<number, string> = { 0: 'balanced', 1: 'turbo', 2: 'silent', 3: 'silent', 4: 'balanced' }

export function App(): ReactNode {
  const { snap, toasts } = useStore()
  const t = useT()
  const [page, setPage] = useState('overview')
  const Page = PAGES.find((p) => p.id === page)!.el
  const tone = snap?.platform ? PROFILE_TONE[snap.platform.profile] : 'balanced'

  return (
    <div className="app" data-tone={tone}>
      <nav className="sidebar" aria-label={t('nav.sections')}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <strong>{t('app.name')}</strong>
            <small>{snap?.product || 'Linux'}</small>
          </div>
        </div>
        {PAGES.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`nav-item ${p.id === page ? 'on' : ''}`}
            aria-current={p.id === page ? 'page' : undefined}
            onClick={() => setPage(p.id)}
          >
            <Icon name={p.icon} />
            <span>{t(p.label)}</span>
          </button>
        ))}
        <div className="sidebar-foot">
          <span className={`pill ${snap?.connected ? 'pill-ok' : 'pill-bad'}`}>
            {snap?.connected ? t('status.asusd', { version: snap.platform?.version ?? '' }) : t('status.offline')}
          </span>
        </div>
      </nav>

      <main className="main">
        <LiveBar />
        {snap && !snap.connected ? (
          <Disconnected error={snap.error} notRunning={snap.errorKind === 'not-running'} />
        ) : !snap ? (
          <div className="empty">{t('status.connecting')}</div>
        ) : (
          <Page />
        )}
      </main>

      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.kind}`}>
            <Icon name={toast.kind === 'error' ? 'warn' : 'info'} size={16} />
            <span>{toast.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function LiveBar(): ReactNode {
  const { sensors: s, snap } = useStore()
  const t = useT()
  const gpuTemp = s?.dgpu === 'active' ? s.dgpuTemp : s?.igpuTemp ?? null
  const fmt = (v: number | null | undefined, digits = 0): string => (v == null ? '–' : v.toFixed(digits))
  const dgpu = s?.dgpu ?? 'absent'
  return (
    <div className="livebar">
      <div className="livebar-mode">
        <small>{t('live.mode')}</small>
        <strong>{snap?.platform ? profileName(t, snap.platform.profile) : '–'}</strong>
      </div>
      <Stat icon="thermo" label={t('live.cpu')} value={fmt(s?.cpuTemp)} unit="°C" tone={tempTone(s?.cpuTemp ?? null)} />
      <Stat
        icon="chip"
        label={s?.dgpu === 'active' ? t('live.dgpu') : t('live.igpu')}
        value={fmt(gpuTemp)}
        unit="°C"
        tone={tempTone(gpuTemp)}
      />
      {s?.fans.map((f) => (
        <Stat
          key={f.label}
          icon="fan"
          label={t('live.fan', { name: t.dyn(`fan.${f.label}`, f.label) })}
          value={f.rpm}
          unit="rpm"
        />
      ))}
      {s?.battery && (
        <Stat
          icon={s.acOnline ? 'plug' : 'battery'}
          label={t.dyn(`batt.state.${s.battery.status}`, s.battery.status)}
          value={`${s.battery.percent}%`}
          unit={s.battery.watts ? ` ${s.battery.watts > 0 ? '+' : ''}${s.battery.watts}W` : ''}
        />
      )}
      <span className={`dgpu-dot dgpu-${dgpu}`} title={t(`dgpu.${dgpu}.title`)}>
        {t(`dgpu.${dgpu}`)}
      </span>
    </div>
  )
}

function Disconnected({ error, notRunning }: { error?: string; notRunning: boolean }): ReactNode {
  const t = useT()
  return (
    <div className="empty">
      <Icon name="warn" size={32} />
      <h2>{t('disconnected.title')}</h2>
      <p>{notRunning ? t('disconnected.notRunning') : (error ?? t('disconnected.generic'))}</p>
      <p className="muted">
        {rich(t, 'disconnected.help', {
          install: <code>pacman -S asusctl</code>,
          enable: <code>sudo systemctl enable --now asusd</code>
        })}
      </p>
    </div>
  )
}
