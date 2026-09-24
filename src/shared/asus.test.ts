import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  auraModeByIndex,
  auraModeByRepr,
  availableGpuModes,
  clampToAttr,
  gpuAttrsFor,
  gpuModeFrom,
  hexToRgb,
  movePoint,
  percentToPwm,
  pwmToPercent,
  rgbToHex,
  sortProfiles,
  validateCurve,
  type ArmouryAttr
} from './asus.ts'

test('GPU mode derives from dgpu_disable + gpu_mux_mode', () => {
  assert.equal(gpuModeFrom(0, 1), 'hybrid')
  assert.equal(gpuModeFrom(1, 1), 'integrated')
  assert.equal(gpuModeFrom(0, 0), 'ultimate')
  assert.equal(gpuModeFrom(1, undefined), 'integrated')
  assert.equal(gpuModeFrom(undefined, undefined), 'hybrid')
})

test('GPU mode round-trips through attribute writes', () => {
  for (const mode of ['integrated', 'hybrid', 'ultimate'] as const) {
    const a = gpuAttrsFor(mode, true)
    assert.equal(gpuModeFrom(a.dgpu_disable, a.gpu_mux_mode), mode)
  }
  assert.deepEqual(gpuAttrsFor('integrated', false), { dgpu_disable: 1 })
  assert.throws(() => gpuAttrsFor('ultimate', false))
  assert.deepEqual(availableGpuModes(true, false), ['integrated', 'hybrid'])
  assert.deepEqual(availableGpuModes(true, true), ['integrated', 'hybrid', 'ultimate'])
})

test('profiles sort Silent → Balanced → Turbo', () => {
  // PlatformProfileChoices as reported by a GA402XV: [2, 0, 1]
  assert.deepEqual(sortProfiles([2, 0, 1]), [2, 0, 1])
  assert.deepEqual(sortProfiles([1, 0, 2]), [2, 0, 1])
  assert.deepEqual(sortProfiles([0, 1, 3]), [3, 0, 1])
})

test('fan curve validation mirrors asusd', () => {
  const ok = { temp: [30, 40, 50, 60, 70, 80, 90, 100], pwm: [0, 10, 20, 40, 80, 120, 200, 255] }
  assert.equal(validateCurve(ok), null)
  assert.deepEqual(validateCurve({ ...ok, temp: [30, 29, 50, 60, 70, 80, 90, 100] }), {
    code: 'decreasing',
    field: 'temp',
    point: 2
  })
  assert.deepEqual(validateCurve({ ...ok, pwm: [0, 10, 5, 40, 80, 120, 200, 255] }), {
    code: 'decreasing',
    field: 'pwm',
    point: 3
  })
  assert.deepEqual(validateCurve({ ...ok, pwm: [0, 1] }), { code: 'count' })
  assert.deepEqual(validateCurve({ ...ok, pwm: [0, 10, 20, 40, 80, 120, 200, 300] }), {
    code: 'range',
    field: 'pwm',
    point: 8
  })
})

test('movePoint keeps the curve monotonic', () => {
  const c = { temp: [30, 40, 50, 60, 70, 80, 90, 100], pwm: [0, 10, 20, 40, 80, 120, 200, 255] }
  const up = movePoint(c, 2, 75, 150)
  assert.deepEqual(up.temp, [30, 40, 75, 75, 75, 80, 90, 100])
  assert.deepEqual(up.pwm, [0, 10, 150, 150, 150, 150, 200, 255])
  assert.equal(validateCurve(up), null)
  const down = movePoint(c, 5, 35, 5)
  assert.deepEqual(down.temp, [30, 35, 35, 35, 35, 35, 90, 100])
  assert.deepEqual(down.pwm, [0, 5, 5, 5, 5, 5, 200, 255])
  assert.equal(validateCurve(down), null)
})

test('pwm and percent conversions', () => {
  assert.equal(pwmToPercent(255), 100)
  assert.equal(pwmToPercent(0), 0)
  assert.equal(percentToPwm(50), 128)
  assert.equal(percentToPwm(120), 255)
})

test('aura mode repr/index tables diverge after Ripple', () => {
  assert.equal(auraModeByRepr(10)?.slug, 'pulse')
  assert.equal(auraModeByIndex(9)?.slug, 'pulse')
  assert.equal(auraModeByRepr(9), undefined)
  assert.equal(auraModeByIndex(3)?.slug, 'rainbow-wave')
})

test('colour conversions', () => {
  assert.equal(rgbToHex([166, 0, 255]), '#a600ff')
  assert.deepEqual(hexToRgb('#A600ff'), [166, 0, 255])
  assert.throws(() => hexToRgb('red'))
})

test('clampToAttr snaps to step and range', () => {
  const a: ArmouryAttr = {
    id: 'ppt_pl1_spl', path: '', current: 35, default: 35, min: 15, max: 80, step: 5, possible: [], queued: -1
  }
  assert.equal(clampToAttr(a, 33), 35)
  assert.equal(clampToAttr(a, 200), 80)
  assert.equal(clampToAttr(a, 1), 15)
})
