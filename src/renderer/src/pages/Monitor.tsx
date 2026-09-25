import { useEffect, useState, type ReactNode } from 'react'
import type { HistorySample } from '@shared/asus'
import { useStore, useT } from '../store'
import { Card, Segmented } from '../ui'
import { HistoryChart, type Series } from '../components/HistoryChart'

const RANGES = [5, 15, 30]

export function Monitor(): ReactNode {
  const { sensors } = useStore()
  const t = useT()
  const [history, setHistory] = useState<HistorySample[]>([])
  const [minutes, setMinutes] = useState(15)

  // The main process keeps the buffer (it also samples while the window is
  // hidden); fetch it again whenever a new reading arrives.
  useEffect(() => {
    void window.asus.history().then(setHistory)
  }, [sensors])

  if (history.length < 2) {
    return (
      <div className="grid">
        <Card title={t('nav.monitor')} icon="chart" className="span-2">
          <p className="muted">{t('monitor.empty')}</p>
        </Card>
      </div>
    )
  }

  const times = history.map((s) => s.t)
  const rangeMs = minutes * 60000
  const col = (f: (s: HistorySample) => number | null): (number | null)[] => history.map(f)
  const fanLabels = sensors?.fans.map((f) => t('live.fan', { name: t.dyn(`fan.${f.label}`, f.label) })) ?? []
  const fanCount = Math.max(...history.map((s) => s.fans.length))
  const fans: Series[] = Array.from({ length: Math.min(fanCount, 3) }, (_, i) => ({
    key: `fan${i}`,
    label: fanLabels[i] ?? t('live.fan', { name: String(i + 1) }),
    slot: i + 1,
    values: col((s) => s.fans[i] ?? null)
  }))
  const hasGpu = history.some((s) => s.gpu !== null)
  const hasPower = history.some((s) => s.watts !== null)
  const hasClock = history.some((s) => s.mhz !== null)

  return (
    <div className="grid">
      <div className="span-2 filter-row">
        <Segmented
          label={t('monitor.range')}
          value={minutes}
          options={RANGES.map((n) => ({ value: n, label: t('monitor.minutes', { n }) }))}
          onChange={setMinutes}
        />
        <p className="muted small">{t('monitor.note')}</p>
      </div>

      <Card title={t('monitor.temps')} icon="thermo">
        <HistoryChart
          title={t('monitor.temps')}
          unit="°C"
          times={times}
          rangeMs={rangeMs}
          series={[
            { key: 'cpu', label: t('monitor.cpu'), slot: 1, values: col((s) => s.cpu) },
            ...(hasGpu ? [{ key: 'gpu', label: t('monitor.gpu'), slot: 2, values: col((s) => s.gpu) }] : [])
          ]}
        />
      </Card>

      {fans.length > 0 && (
        <Card title={t('monitor.fans')} icon="fan">
          <HistoryChart title={t('monitor.fans')} unit=" rpm" times={times} rangeMs={rangeMs} series={fans} zero />
        </Card>
      )}

      {hasPower && (
        <Card title={t('monitor.power')} icon="bolt">
          <HistoryChart
            title={t('monitor.power')}
            unit=" W"
            digits={1}
            times={times}
            rangeMs={rangeMs}
            zero
            series={[{ key: 'watts', label: t('monitor.battery'), slot: 1, values: col((s) => s.watts) }]}
          />
          <p className="muted small">{t('monitor.powerHint')}</p>
        </Card>
      )}

      {hasClock && (
        <Card title={t('monitor.clock')} icon="chip">
          <HistoryChart
            title={t('monitor.clock')}
            unit=" MHz"
            times={times}
            rangeMs={rangeMs}
            series={[{ key: 'mhz', label: t('monitor.average'), slot: 1, values: col((s) => s.mhz) }]}
          />
        </Card>
      )}
    </div>
  )
}
