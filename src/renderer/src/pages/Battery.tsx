import type { ReactNode } from 'react'
import { sortProfiles } from '@shared/asus'
import { profileName } from '@shared/i18n'
import { useStore, useT } from '../store'
import { Button, Card, Row, Segmented, Slider, Stat, Toggle } from '../ui'

export function Battery(): ReactNode {
  const { snap, sensors, act, busy } = useStore()
  const t = useT()
  const p = snap?.platform
  if (!p) return null
  const b = sensors?.battery
  const choices = sortProfiles(p.choices).map((c) => ({ value: c, label: profileName(t, c) }))

  return (
    <div className="grid">
      <Card title={t('batt.status')} icon="battery" className="span-2">
        {b ? (
          <div className="stats">
            <Stat icon="battery" label={t('batt.charge')} value={b.percent} unit="%" />
            <Stat
              icon={sensors?.acOnline ? 'plug' : 'battery'}
              label={t('batt.state')}
              value={t.dyn(`batt.state.${b.status}`, b.status)}
            />
            <Stat icon="bolt" label={t('batt.power')} value={b.watts ?? '–'} unit={b.watts != null ? ' W' : ''} />
            <Stat icon="info" label={t('batt.health')} value={b.health ?? '–'} unit={b.health != null ? '%' : ''} />
            {b.cycles != null && <Stat icon="reset" label={t('batt.cycles')} value={b.cycles} />}
          </div>
        ) : (
          <p className="muted">{t('batt.waiting')}</p>
        )}
      </Card>

      {p.chargeLimit != null && (
        <Card title={t('battery.limit')} icon="battery">
          <Slider
            label={t('battery.limit')}
            value={p.chargeLimit}
            min={20}
            max={100}
            unit="%"
            marks={[60, 80, 100]}
            onCommit={(v) => act({ type: 'setPlatform', prop: 'ChargeControlEndThreshold', value: v })}
          />
          <p className="muted small">{t('batt.limitTip')}</p>
          <Button
            icon="bolt"
            disabled={busy.has('oneShotFullCharge')}
            onClick={() => act({ type: 'oneShotFullCharge' }, t('batt.fullOnceDone'))}
          >
            {t('batt.fullOnce')}
          </Button>
        </Card>
      )}

      <Card title={t('auto.title')} icon="plug">
        <Row label={t('auto.ac')} hint={t('auto.acHint')}>
          <Toggle
            label={t('auto.ac')}
            checked={p.changeProfileOnAc}
            disabled={busy.has('platform:ChangePlatformProfileOnAc')}
            onChange={(v) => act({ type: 'setPlatform', prop: 'ChangePlatformProfileOnAc', value: v })}
          />
        </Row>
        {p.changeProfileOnAc && (
          <Segmented
            label={t('auto.acMode')}
            value={p.profileOnAc}
            options={choices}
            onChange={(v) => act({ type: 'setPlatform', prop: 'PlatformProfileOnAc', value: v })}
          />
        )}
        <Row label={t('auto.battery')} hint={t('auto.batteryHint')}>
          <Toggle
            label={t('auto.battery')}
            checked={p.changeProfileOnBattery}
            disabled={busy.has('platform:ChangePlatformProfileOnBattery')}
            onChange={(v) => act({ type: 'setPlatform', prop: 'ChangePlatformProfileOnBattery', value: v })}
          />
        </Row>
        {p.changeProfileOnBattery && (
          <Segmented
            label={t('auto.batteryMode')}
            value={p.profileOnBattery}
            options={choices}
            onChange={(v) => act({ type: 'setPlatform', prop: 'PlatformProfileOnBattery', value: v })}
          />
        )}
        <Row label={t('auto.nvpowerd')} hint={t('auto.nvpowerdHint')}>
          <Toggle
            label={t('auto.nvpowerd')}
            checked={p.disableNvidiaPowerdOnBattery}
            onChange={(v) => act({ type: 'setPlatform', prop: 'DisableNvidiaPowerdOnBattery', value: v })}
          />
        </Row>
      </Card>
    </div>
  )
}
