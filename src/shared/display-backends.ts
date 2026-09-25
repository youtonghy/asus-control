// Pure parsing / command building for the refresh-rate backends. The main
// process (main/display.ts) runs the tools and D-Bus calls; everything that
// interprets their output lives here so it can be unit-tested without a
// compositor.

import type { DisplayMode, GamutMode, GamutState } from './asus.ts'

/** The internal panel as one backend sees it. Mode ids are backend-specific. */
export interface Panel {
  output: string
  currentModeId: string
  modes: DisplayMode[]
}

const isInternal = (name: string): boolean => /^(eDP|LVDS|DSI)/i.test(name)

/** One entry per distinct refresh rate at the current resolution, slowest first. */
export function ratesAtCurrentSize(p: Panel): DisplayMode[] {
  const current = p.modes.find((m) => m.id === p.currentModeId)
  if (!current) return []
  const byRate = new Map<number, DisplayMode>()
  for (const m of p.modes) {
    if (m.width !== current.width || m.height !== current.height) continue
    const rounded = Math.round(m.refresh)
    if (m.id === p.currentModeId || !byRate.has(rounded)) byRate.set(rounded, m)
  }
  return [...byRate.values()].sort((a, b) => a.refresh - b.refresh)
}

// ---------------------------------------------------------------- KDE (kscreen-doctor -j)

interface KScreenOutput {
  name: string
  enabled: boolean
  currentModeId: string | number
  modes: { id: string | number; size: { width: number; height: number }; refreshRate: number }[]
}

export function parseKscreen(json: string): Panel | null {
  const outputs: KScreenOutput[] = JSON.parse(json).outputs ?? []
  const out = outputs.find((o) => o.enabled && isInternal(o.name)) ?? outputs.find((o) => o.enabled)
  if (!out) return null
  return {
    output: out.name,
    currentModeId: String(out.currentModeId),
    modes: out.modes.map((m) => ({ id: String(m.id), width: m.size.width, height: m.size.height, refresh: m.refreshRate }))
  }
}

/**
 * Colour state from `kscreen-doctor -o` (its JSON lacks the profile source).
 * Labels are not translated, but run it with LC_ALL=C anyway.
 */
export function parseKscreenColor(text: string, output: string): GamutState | null {
  const plain = text.replace(/\x1b\[[0-9;]*m/g, '')
  const blocks = plain.split(/^Output:/m)
  const block = blocks.find((b) => new RegExp(`^\\s*\\d+\\s+${output.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s`).test(b))
  const source = block && /Color profile source:\s*(\S+)/.exec(block)?.[1]
  if (!source) return null
  const icc = /ICC profile:\s*(.+)/.exec(block)?.[1].trim()
  const mode: GamutMode | null = source === 'sRGB' ? 'native' : source === 'EDID' ? 'srgb' : source === 'ICC' ? 'icc' : null
  return { mode, icc: icc && icc !== 'none' ? icc : null, modes: ['native', 'srgb', 'icc'] }
}

/** kscreen-doctor arguments for a gamut mode. */
export function kscreenGamutArgs(output: string, mode: GamutMode, icc?: string): string[] {
  const o = `output.${output}`
  if (mode === 'native') return [`${o}.colorProfileSource.sRGB`]
  if (mode === 'srgb') return [`${o}.colorProfileSource.EDID`]
  if (!icc) throw new Error('No ICC profile selected')
  return [`${o}.iccprofile.${icc}`, `${o}.colorProfileSource.ICC`]
}

// ---------------------------------------------------------------- Hyprland (hyprctl -j monitors)

export interface HyprMonitor {
  name: string
  width: number
  height: number
  refreshRate: number
  x: number
  y: number
  scale: number
  transform?: number
  disabled?: boolean
  availableModes?: string[]
  /** Hyprland >= 0.48: the `cm` preset (srgb, edid, wide, dcip3, ...). */
  colorManagementPreset?: string
}

const hyprId = (w: number, h: number, r: number): string => `${w}x${h}@${r.toFixed(2)}`

function pickHypr(json: string): HyprMonitor | undefined {
  const mons: HyprMonitor[] = JSON.parse(json)
  return mons.find((m) => !m.disabled && isInternal(m.name)) ?? mons.find((m) => !m.disabled)
}

export function parseHyprland(json: string): Panel | null {
  const mon = pickHypr(json)
  if (!mon) return null
  const modes: DisplayMode[] = []
  for (const s of mon.availableModes ?? []) {
    const m = /^(\d+)x(\d+)@([\d.]+)Hz$/.exec(s)
    if (m) {
      const [w, h, r] = [Number(m[1]), Number(m[2]), Number(m[3])]
      modes.push({ id: hyprId(w, h, r), width: w, height: h, refresh: r })
    }
  }
  const currentModeId = hyprId(mon.width, mon.height, mon.refreshRate)
  if (!modes.some((m) => m.id === currentModeId)) {
    modes.push({ id: currentModeId, width: mon.width, height: mon.height, refresh: mon.refreshRate })
  }
  return { output: mon.name, currentModeId, modes }
}

/**
 * `hyprctl keyword monitor <arg>` keeping position, scale, rotation and colour
 * preset; pass `modeId` and/or `cm` to change them.
 */
export function hyprlandMonitorArg(json: string, change: { modeId?: string; cm?: string }): string {
  const mon = pickHypr(json)
  if (!mon) throw new Error('No active monitor')
  const mode = change.modeId ?? hyprId(mon.width, mon.height, mon.refreshRate)
  const parts = [mon.name, mode, `${mon.x}x${mon.y}`, String(mon.scale)]
  if (mon.transform) parts.push('transform', String(mon.transform))
  const cm = change.cm ?? mon.colorManagementPreset
  if (cm && cm !== 'auto') parts.push('cm', cm)
  return parts.join(',')
}

/** Native = treat the panel as sRGB (no mapping); sRGB = map with EDID primaries. */
export function hyprlandGamut(json: string): GamutState | null {
  const preset = pickHypr(json)?.colorManagementPreset
  if (preset === undefined) return null // Hyprland without colour management
  const mode: GamutMode | null = preset === 'edid' ? 'srgb' : preset === 'srgb' || preset === 'auto' ? 'native' : null
  return { mode, icc: null, modes: ['native', 'srgb'] }
}

export const HYPRLAND_CM: Partial<Record<GamutMode, string>> = { native: 'srgb', srgb: 'edid' }

// ---------------------------------------------------------------- Sway (swaymsg -t get_outputs -r)

interface SwayMode {
  width: number
  height: number
  /** mHz */
  refresh: number
}
interface SwayOutput {
  name: string
  active: boolean
  current_mode?: SwayMode
  modes?: SwayMode[]
}

const swayId = (m: SwayMode): string => `${m.width}x${m.height}@${(m.refresh / 1000).toFixed(3)}Hz`

export function parseSway(json: string): Panel | null {
  const outs: SwayOutput[] = JSON.parse(json)
  const out = outs.find((o) => o.active && isInternal(o.name)) ?? outs.find((o) => o.active)
  if (!out?.current_mode) return null
  const toMode = (m: SwayMode): DisplayMode => ({ id: swayId(m), width: m.width, height: m.height, refresh: m.refresh / 1000 })
  const modes = (out.modes ?? []).map(toMode)
  const currentModeId = swayId(out.current_mode)
  if (!modes.some((m) => m.id === currentModeId)) modes.push(toMode(out.current_mode))
  return { output: out.name, currentModeId, modes }
}

// ---------------------------------------------------------------- GNOME (org.gnome.Mutter.DisplayConfig)

/** A D-Bus a{sv} as dbus-next returns it. */
type Props = Record<string, { value: unknown }>
type MonitorSpec = [string, string, string, string]
type GnomeMode = [string, number, number, number, number, number[], Props]
type GnomeMonitor = [MonitorSpec, GnomeMode[], Props]
type GnomeLogical = [number, number, number, number, boolean, MonitorSpec[], Props]
/** The reply of `GetCurrentState`: serial, monitors, logical monitors, properties. */
export type GnomeState = [number, GnomeMonitor[], GnomeLogical[], Props]

function gnomePanelMonitor(state: GnomeState): GnomeMonitor | undefined {
  const active = new Set(state[2].flatMap((l) => l[5].map((s) => s[0])))
  const mons = state[1].filter((m) => active.has(m[0][0]))
  return mons.find((m) => m[2]['is-builtin']?.value === true || isInternal(m[0][0])) ?? mons[0]
}

const gnomeCurrent = (m: GnomeMonitor): GnomeMode | undefined => m[1].find((x) => x[6]['is-current']?.value === true)

export function parseGnome(state: GnomeState): Panel | null {
  const mon = gnomePanelMonitor(state)
  const cur = mon && gnomeCurrent(mon)
  if (!mon || !cur) return null
  return {
    output: mon[0][0],
    currentModeId: cur[0],
    modes: mon[1].map((m) => ({ id: m[0], width: m[1], height: m[2], refresh: m[3] }))
  }
}

/**
 * Arguments for `ApplyMonitorsConfig` that keep the whole layout and only
 * change the panel's mode. Each monitor keeps its current mode.
 */
export function gnomeApplyArgs(
  state: GnomeState,
  modeId: string
): { serial: number; logical: [number, number, number, number, boolean, [string, string, Props][]][]; layoutMode?: number } {
  const panel = gnomePanelMonitor(state)
  if (!panel) throw new Error('No active monitor')
  if (!panel[1].some((m) => m[0] === modeId)) throw new Error(`Unknown display mode ${modeId}`)
  const byConnector = new Map(state[1].map((m) => [m[0][0], m]))
  const logical = state[2].map((l) => {
    const monitors = l[5].map((spec): [string, string, Props] => {
      const mon = byConnector.get(spec[0])
      const mode = spec[0] === panel[0][0] ? modeId : mon && gnomeCurrent(mon)?.[0]
      if (!mode) throw new Error(`No current mode for ${spec[0]}`)
      return [spec[0], mode, {}]
    })
    return [l[0], l[1], l[2], l[3], l[4], monitors] as [number, number, number, number, boolean, [string, string, Props][]]
  })
  const lm = state[3]['layout-mode']?.value
  return { serial: state[0], logical, layoutMode: typeof lm === 'number' ? lm : undefined }
}
