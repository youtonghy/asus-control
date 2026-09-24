import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Sensors } from './asus.ts'
import { translator } from './i18n/index.ts'
import { trayTooltip } from './tray-tooltip.ts'

const base: Sensors = {
  cpuTemp: 63.6,
  igpuTemp: 52.9,
  dgpuTemp: null,
  dgpu: 'suspended',
  dgpuName: null,
  fans: [
    { label: 'CPU', rpm: 2500 },
    { label: 'GPU', rpm: 2700 }
  ],
  cpuMhz: 3000,
  battery: null,
  acOnline: true
}

test('tooltip lists mode, CPU/GPU temperature and every fan', () => {
  assert.equal(
    trayTooltip(translator('en'), 1, base),
    ['ASUS Control · Turbo', 'CPU: 64°C', 'iGPU: 53°C', 'CPU fan: 2500 rpm', 'GPU fan: 2700 rpm'].join('\n')
  )
})

test('awake dGPU replaces the iGPU reading', () => {
  const tip = trayTooltip(translator('en'), 0, { ...base, dgpu: 'active', dgpuTemp: 48 })
  assert.match(tip, /^dGPU: 48°C$/m)
  assert.doesNotMatch(tip, /iGPU/)
})

test('awake dGPU without a reading yet falls back to the iGPU', () => {
  assert.match(trayTooltip(translator('en'), 0, { ...base, dgpu: 'active' }), /^iGPU: 53°C$/m)
})

test('tooltip is localized', () => {
  assert.equal(
    trayTooltip(translator('zh-CN'), 2, base),
    ['ASUS Control · 静音', 'CPU：64°C', '核显：53°C', 'CPU 风扇：2500 rpm', 'GPU 风扇：2700 rpm'].join('\n')
  )
})

test('before any reading only the title is shown', () => {
  assert.equal(trayTooltip(translator('ko'), null, null), 'ASUS Control')
})
