// Shared types and value mappings for the asusd (asusctl >= 6.x) D-Bus API.
// Everything here is pure so it can be used from main, preload and renderer.

export const ASUSD_SERVICE = 'xyz.ljones.Asusd'
export const ASUSD_ROOT = '/xyz/ljones'
export const ARMOURY_ROOT = '/xyz/ljones/asus_armoury'
export const AURA_ROOT = '/xyz/ljones/aura'

// ---------------------------------------------------------------- Platform

/** rog-platform `PlatformProfile` discriminants. */
export const PlatformProfile = {
  Balanced: 0,
  Performance: 1,
  Quiet: 2,
  LowPower: 3,
  Custom: 4
} as const

/** Display order: Silent, Balanced, Turbo, then the rest. */
export function sortProfiles(choices: number[]): number[] {
  const order = [
    PlatformProfile.LowPower,
    PlatformProfile.Quiet,
    PlatformProfile.Balanced,
    PlatformProfile.Performance,
    PlatformProfile.Custom
  ]
  return [...choices].sort((a, b) => order.indexOf(a as never) - order.indexOf(b as never))
}

// ---------------------------------------------------------------- GPU

export type GpuMode = 'integrated' | 'hybrid' | 'ultimate'

/**
 * Derive the GPU mode from the `dgpu_disable` and `gpu_mux_mode` firmware
 * attributes. Mirrors rog-control-center's setup_gpu.rs. `mux` is undefined
 * on laptops without a MUX switch.
 */
export function gpuModeFrom(dgpuDisable: number | undefined, mux: number | undefined): GpuMode {
  if (mux === 0) return 'ultimate'
  if (dgpuDisable === 1) return 'integrated'
  return 'hybrid'
}

/** Firmware attribute writes needed to reach a GPU mode. */
export function gpuAttrsFor(mode: GpuMode, hasMux: boolean): Record<string, number> {
  const attrs: Record<string, number> = {}
  switch (mode) {
    case 'integrated':
      attrs.dgpu_disable = 1
      if (hasMux) attrs.gpu_mux_mode = 1
      break
    case 'ultimate':
      if (!hasMux) throw new Error('Ultimate mode needs a GPU MUX')
      attrs.dgpu_disable = 0
      attrs.gpu_mux_mode = 0
      break
    case 'hybrid':
      attrs.dgpu_disable = 0
      if (hasMux) attrs.gpu_mux_mode = 1
      break
  }
  return attrs
}

export function availableGpuModes(hasDgpuDisable: boolean, hasMux: boolean): GpuMode[] {
  const modes: GpuMode[] = []
  if (hasDgpuDisable) modes.push('integrated')
  if (hasDgpuDisable || hasMux) modes.push('hybrid')
  if (hasMux) modes.push('ultimate')
  return modes
}

// ---------------------------------------------------------------- Armoury

export interface ArmouryAttr {
  /** Object path basename, e.g. `ppt_pl1_spl`. */
  id: string
  path: string
  current: number
  default: number
  min: number
  max: number
  step: number
  possible: number[]
  /** GPU attributes are queued until shutdown; -1 when nothing is queued. */
  queued: number
  /** Kernel `display_name` from /sys/class/firmware-attributes, if present. */
  displayName?: string
}

export type ArmouryGroup = 'power' | 'gpu' | 'display' | 'system' | 'battery'

/** Non-text metadata; labels and descriptions live in i18n as `attr.<id>`. */
export interface ArmouryMeta {
  group: ArmouryGroup
  unit?: string
  /** Hidden from the generic attribute list because a dedicated card owns it. */
  dedicated?: boolean
  /** Reported by firmware only; writing it has no effect. */
  readOnly?: boolean
}

export const ARMOURY_META: Record<string, ArmouryMeta> = {
  ppt_pl1_spl: { group: 'power', unit: 'W' },
  ppt_pl2_sppt: { group: 'power', unit: 'W' },
  ppt_pl3_fppt: { group: 'power', unit: 'W' },
  ppt_fppt: { group: 'power', unit: 'W' },
  ppt_apu_sppt: { group: 'power', unit: 'W' },
  ppt_platform_sppt: { group: 'power', unit: 'W' },
  nv_dynamic_boost: { group: 'power', unit: 'W' },
  nv_temp_target: { group: 'power', unit: '°C' },
  nv_base_tgp: { group: 'power', unit: 'W', readOnly: true },
  nv_tgp: { group: 'power', unit: 'W' },
  apu_mem: { group: 'system', unit: 'GB' },
  cores_performance: { group: 'system' },
  cores_efficiency: { group: 'system' },
  charge_mode: { group: 'battery', readOnly: true },
  boot_sound: { group: 'system' },
  mcu_powersave: { group: 'system' },
  panel_overdrive: { group: 'display', dedicated: true },
  panel_hd_mode: { group: 'display' },
  mini_led_mode: { group: 'display' },
  screen_auto_brightness: { group: 'display' },
  egpu_connected: { group: 'gpu', readOnly: true },
  egpu_enable: { group: 'gpu' },
  dgpu_disable: { group: 'gpu', dedicated: true },
  gpu_mux_mode: { group: 'gpu', dedicated: true },
  pending_reboot: { group: 'system', readOnly: true }
}

/**
 * Attributes asusd stores per profile + AC/battery "tuning" group. Writes are
 * refused unless EnablePptGroup is on (which in turn needs custom fan curves).
 */
export const PPT_ATTRS = new Set([
  'ppt_pl1_spl',
  'ppt_pl2_sppt',
  'ppt_pl3_fppt',
  'ppt_apu_sppt',
  'ppt_platform_sppt',
  'ppt_fppt',
  'nv_dynamic_boost',
  'nv_temp_target',
  'nv_tgp'
])

export function armouryMeta(id: string): ArmouryMeta {
  return ARMOURY_META[id] ?? { group: 'system' }
}

/** A value attribute is a slider; otherwise it is a discrete choice. */
export function isRangeAttr(a: ArmouryAttr): boolean {
  return a.possible.length === 0 && a.min >= 0 && a.max > a.min
}

export function clampToAttr(a: ArmouryAttr, v: number): number {
  const step = a.step > 0 ? a.step : 1
  const snapped = Math.round((v - a.min) / step) * step + a.min
  return Math.min(a.max, Math.max(a.min, snapped))
}

// ---------------------------------------------------------------- Fans

export type FanId = 'CPU' | 'GPU' | 'MID'

export interface FanCurve {
  fan: FanId
  /** 8 PWM points, 0..255 */
  pwm: number[]
  /** 8 temperature points in °C */
  temp: number[]
  enabled: boolean
}

export const pwmToPercent = (pwm: number): number => Math.round((pwm / 255) * 100)
export const percentToPwm = (pct: number): number =>
  Math.min(255, Math.max(0, Math.round((pct / 100) * 255)))

export type CurveError =
  | { code: 'count' }
  | { code: 'range'; field: 'temp' | 'pwm'; point: number }
  | { code: 'decreasing'; field: 'temp' | 'pwm'; point: number }

/**
 * asusd rejects a curve unless both temp and pwm are non-decreasing. Returns
 * a structured error so each UI language can phrase it; `point` is 1-based and
 * for `decreasing` names the second point of the offending pair.
 */
export function validateCurve(c: Pick<FanCurve, 'pwm' | 'temp'>): CurveError | null {
  if (c.pwm.length !== 8 || c.temp.length !== 8) return { code: 'count' }
  for (const field of ['temp', 'pwm'] as const) {
    const pts = c[field]
    for (let i = 0; i < pts.length; i++) {
      if (!Number.isInteger(pts[i]) || pts[i] < 0 || pts[i] > 255) return { code: 'range', field, point: i + 1 }
      if (i > 0 && pts[i - 1] > pts[i]) return { code: 'decreasing', field, point: i + 1 }
    }
  }
  return null
}

/**
 * Move one point of a curve while keeping the curve monotonic: neighbours are
 * pushed along instead of the move being rejected, which feels natural when
 * dragging in the editor.
 */
export function movePoint(
  c: Pick<FanCurve, 'pwm' | 'temp'>,
  index: number,
  temp: number,
  pwm: number,
  tempRange: [number, number] = [0, 120]
): { temp: number[]; pwm: number[] } {
  const t = [...c.temp]
  const p = [...c.pwm]
  t[index] = Math.round(Math.min(tempRange[1], Math.max(tempRange[0], temp)))
  p[index] = Math.round(Math.min(255, Math.max(0, pwm)))
  for (let i = index + 1; i < 8; i++) {
    if (t[i] < t[i - 1]) t[i] = t[i - 1]
    if (p[i] < p[i - 1]) p[i] = p[i - 1]
  }
  for (let i = index - 1; i >= 0; i--) {
    if (t[i] > t[i + 1]) t[i] = t[i + 1]
    if (p[i] > p[i + 1]) p[i] = p[i + 1]
  }
  return { temp: t, pwm: p }
}

// ---------------------------------------------------------------- Aura

export interface AuraModeDef {
  /** Stable id: CSS preview class and i18n key `aura.mode.<slug>`. */
  slug: string
  /** Enum discriminant, used by D-Bus *properties* (LedMode, LedModeData, SupportedBasicModes). */
  repr: number
  /** Serde variant index, used by D-Bus *method* replies (AllModeData keys). */
  index: number
  colours: 0 | 1 | 2
  speed: boolean
  direction: boolean
}

// The daemon exposes the same Rust enum two ways: zvariant `Value` conversions
// (properties) use the discriminant, while serde (method replies) uses the
// variant index. They diverge from Pulse onwards because 9 is unused.
export const AURA_MODES: AuraModeDef[] = [
  { slug: 'static', repr: 0, index: 0, colours: 1, speed: false, direction: false },
  { slug: 'breathe', repr: 1, index: 1, colours: 2, speed: true, direction: false },
  { slug: 'rainbow-cycle', repr: 2, index: 2, colours: 0, speed: true, direction: false },
  { slug: 'rainbow-wave', repr: 3, index: 3, colours: 0, speed: true, direction: true },
  { slug: 'stars', repr: 4, index: 4, colours: 2, speed: true, direction: false },
  { slug: 'rain', repr: 5, index: 5, colours: 0, speed: true, direction: false },
  { slug: 'highlight', repr: 6, index: 6, colours: 1, speed: true, direction: false },
  { slug: 'laser', repr: 7, index: 7, colours: 1, speed: true, direction: false },
  { slug: 'ripple', repr: 8, index: 8, colours: 1, speed: true, direction: false },
  { slug: 'pulse', repr: 10, index: 9, colours: 1, speed: false, direction: false },
  { slug: 'comet', repr: 11, index: 10, colours: 1, speed: false, direction: false },
  { slug: 'flash', repr: 12, index: 11, colours: 1, speed: false, direction: false }
]

export const auraModeByRepr = (repr: number): AuraModeDef | undefined =>
  AURA_MODES.find((m) => m.repr === repr)
export const auraModeByIndex = (index: number): AuraModeDef | undefined =>
  AURA_MODES.find((m) => m.index === index)

export const AURA_BRIGHTNESS = ['Off', 'Low', 'Med', 'High'] as const
export const AURA_SPEEDS = ['Low', 'Med', 'High'] as const
export const AURA_DIRECTIONS = ['Right', 'Left', 'Up', 'Down'] as const

export type Rgb = [number, number, number]

export interface AuraEffect {
  mode: number // repr
  zone: number
  colour1: Rgb
  colour2: Rgb
  speed: string
  direction: string
}

export interface AuraPowerState {
  zone: number
  boot: boolean
  awake: boolean
  sleep: boolean
  shutdown: boolean
}

export interface AuraDevice {
  path: string
  id: string
  deviceType: number
  brightness: number
  supportedBrightness: number[]
  supportedModes: number[] // repr values
  effect: AuraEffect | null
  /** Stored per-mode settings, keyed by repr. */
  modeData: Record<number, AuraEffect>
  power: AuraPowerState[]
}

export const rgbToHex = ([r, g, b]: Rgb): string =>
  '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim())
  if (!m) throw new Error(`Invalid colour ${hex}`)
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
}

// ---------------------------------------------------------------- Snapshot

export interface PlatformState {
  version: string
  profile: number
  choices: number[]
  profileOnAc: number
  profileOnBattery: number
  changeProfileOnAc: boolean
  changeProfileOnBattery: boolean
  chargeLimit: number | null
  linkedEpp: boolean
  epp: { quiet: number; balanced: number; performance: number }
  pptGroup: boolean
  disableNvidiaPowerdOnBattery: boolean
}

export interface AsusSnapshot {
  connected: boolean
  /** Raw error text (from D-Bus, untranslated). */
  error?: string
  /** Lets the UI show a localized explanation for well-known failures. */
  errorKind?: 'not-running' | 'other'
  product: string
  platform: PlatformState | null
  armoury: ArmouryAttr[]
  /** Fan curves of the active profile; null when unsupported. */
  fans: FanCurve[] | null
  aura: AuraDevice[]
}

export interface Sensors {
  cpuTemp: number | null
  igpuTemp: number | null
  dgpuTemp: number | null
  /** dGPU state from PCI runtime PM, so we never wake it just to read a temp. */
  dgpu: 'active' | 'suspended' | 'absent'
  dgpuName: string | null
  fans: { label: string; rpm: number }[]
  cpuMhz: number | null
  battery: {
    percent: number
    status: string
    /** Positive while charging, negative while discharging. */
    watts: number | null
    health: number | null
    cycles: number | null
  } | null
  acOnline: boolean | null
}

export interface DisplayMode {
  id: string
  width: number
  height: number
  refresh: number
}

export interface DisplayState {
  backend: 'kscreen' | 'none'
  output: string | null
  currentModeId: string | null
  /** Refresh rates available at the current resolution. */
  rates: DisplayMode[]
}

/** Platform properties that may be written, with their D-Bus signature. */
export const PLATFORM_WRITABLE = {
  ChangePlatformProfileOnAc: 'b',
  ChangePlatformProfileOnBattery: 'b',
  ChargeControlEndThreshold: 'y',
  DisableNvidiaPowerdOnBattery: 'b',
  EnablePptGroup: 'b',
  PlatformProfile: 'u',
  PlatformProfileLinkedEpp: 'b',
  PlatformProfileOnAc: 'u',
  PlatformProfileOnBattery: 'u',
  ProfileBalancedEpp: 'u',
  ProfilePerformanceEpp: 'u',
  ProfileQuietEpp: 'u'
} as const

export type PlatformProp = keyof typeof PLATFORM_WRITABLE

export type AsusAction =
  | { type: 'setPlatform'; prop: PlatformProp; value: number | boolean }
  | { type: 'setArmoury'; id: string; value: number }
  | { type: 'restoreArmoury'; id: string }
  | { type: 'setGpuMode'; mode: GpuMode }
  | { type: 'setFanCurve'; profile: number; curve: FanCurve }
  | { type: 'setFanCurvesEnabled'; profile: number; enabled: boolean }
  | { type: 'resetFanCurves'; profile: number }
  | { type: 'getFanCurves'; profile: number }
  | { type: 'setAuraBrightness'; path: string; value: number }
  | { type: 'setAuraEffect'; path: string; effect: AuraEffect }
  | { type: 'setAuraPower'; path: string; power: AuraPowerState[] }
  | { type: 'oneShotFullCharge' }
  | { type: 'setDisplayMode'; modeId: string }

export interface AppSettings {
  /** 'system' or a locale id from shared/i18n. */
  language: 'system' | 'en' | 'zh-CN' | 'ja' | 'ko'
  closeToTray: boolean
  startHidden: boolean
  autostart: boolean
}
