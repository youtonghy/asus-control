// Internal panel refresh rate and colour gamut (G-Helper's "Screen" section).
// Backends: KDE Plasma (kscreen-doctor), GNOME (Mutter DisplayConfig over
// D-Bus), Hyprland (hyprctl) and Sway (swaymsg). Other desktops report
// backend "none". Output parsing lives in shared/display-backends.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import dbus from 'dbus-next'
import type { DisplayBackend, DisplayState, GamutMode, GamutState } from '@shared/asus'
import {
  HYPRLAND_CM,
  gnomeApplyArgs,
  hyprlandGamut,
  hyprlandMonitorArg,
  kscreenGamutArgs,
  parseKscreenColor,
  parseGnome,
  parseHyprland,
  parseKscreen,
  parseSway,
  ratesAtCurrentSize,
  type GnomeState,
  type Panel
} from '@shared/display-backends'

const run = promisify(execFile)

const NONE: DisplayState = { backend: 'none', output: null, currentModeId: null, rates: [], gamut: null }

const MUTTER = 'org.gnome.Mutter.DisplayConfig'
const MUTTER_PATH = '/org/gnome/Mutter/DisplayConfig'

interface Backend {
  id: DisplayBackend
  panel(): Promise<Panel | null>
  setMode(modeId: string): Promise<void>
  /** Colour gamut, for backends whose compositor has colour management. */
  gamut?(output: string): Promise<GamutState | null>
  setGamut?(output: string, mode: GamutMode, icc?: string): Promise<void>
}

const kscreen: Backend = {
  id: 'kscreen',
  async panel() {
    const { stdout } = await run('kscreen-doctor', ['-j'], { timeout: 4000 })
    return parseKscreen(stdout)
  },
  async setMode(modeId) {
    const p = await this.panel()
    if (!p) throw new Error('No active display')
    await run('kscreen-doctor', [`output.${p.output}.mode.${modeId}`], { timeout: 8000 })
  },
  async gamut(output) {
    const { stdout } = await run('kscreen-doctor', ['-o'], { timeout: 4000, env: { ...process.env, LC_ALL: 'C' } })
    return parseKscreenColor(stdout, output)
  },
  async setGamut(output, mode, icc) {
    await run('kscreen-doctor', kscreenGamutArgs(output, mode, icc), { timeout: 8000 })
  }
}

const hyprland: Backend = {
  id: 'hyprland',
  async panel() {
    const { stdout } = await run('hyprctl', ['-j', 'monitors'], { timeout: 4000 })
    return parseHyprland(stdout)
  },
  async setMode(modeId) {
    await hyprMonitor({ modeId })
  },
  async gamut() {
    const { stdout } = await run('hyprctl', ['-j', 'monitors'], { timeout: 4000 })
    return hyprlandGamut(stdout)
  },
  async setGamut(_output, mode) {
    const cm = HYPRLAND_CM[mode]
    if (!cm) throw new Error(`Hyprland has no ${mode} colour mode`)
    await hyprMonitor({ cm })
  }
}

async function hyprMonitor(change: { modeId?: string; cm?: string }): Promise<void> {
  const { stdout } = await run('hyprctl', ['-j', 'monitors'], { timeout: 4000 })
  const { stdout: out } = await run('hyprctl', ['keyword', 'monitor', hyprlandMonitorArg(stdout, change)], {
    timeout: 8000
  })
  // hyprctl exits 0 and prints the error on failure.
  if (out.trim() && out.trim() !== 'ok') throw new Error(out.trim())
}

const sway: Backend = {
  id: 'sway',
  async panel() {
    const { stdout } = await run('swaymsg', ['-t', 'get_outputs', '-r'], { timeout: 4000 })
    return parseSway(stdout)
  },
  async setMode(modeId) {
    const p = await this.panel()
    if (!p) throw new Error('No active display')
    await run('swaymsg', ['output', p.output, 'mode', modeId], { timeout: 8000 })
  }
}

let sessionBus: dbus.MessageBus | null = null
async function mutter(): Promise<dbus.ClientInterface> {
  sessionBus ??= dbus.sessionBus()
  const obj = await sessionBus.getProxyObject(MUTTER, MUTTER_PATH)
  return obj.getInterface(MUTTER)
}

const gnome: Backend = {
  id: 'gnome',
  async panel() {
    const state = (await (await mutter()).GetCurrentState()) as GnomeState
    return parseGnome(state)
  },
  async setMode(modeId) {
    const iface = await mutter()
    const state = (await iface.GetCurrentState()) as GnomeState
    const { serial, logical, layoutMode } = gnomeApplyArgs(state, modeId)
    const props: Record<string, dbus.Variant> = {}
    if (layoutMode !== undefined) props['layout-mode'] = new dbus.Variant('u', layoutMode)
    // Method 2 = persistent, like applying in GNOME Settings.
    await iface.ApplyMonitorsConfig(serial, 2, logical, props)
  }
}

/** Pick the backend for the running session. */
function detect(): Backend | null {
  const desktop = (process.env.XDG_CURRENT_DESKTOP ?? '').toUpperCase()
  if (process.env.HYPRLAND_INSTANCE_SIGNATURE) return hyprland
  if (process.env.SWAYSOCK) return sway
  if (desktop.includes('KDE')) return kscreen
  if (desktop.includes('GNOME')) return gnome
  return null
}

export class DisplayControl {
  private backend: Backend | null | undefined

  private async resolve(): Promise<Backend | null> {
    if (this.backend !== undefined) return this.backend
    const b = detect()
    if (b) return (this.backend = b)
    // Unknown desktop: kscreen-doctor also works on KDE sessions that don't
    // set XDG_CURRENT_DESKTOP, so give it a try.
    try {
      await kscreen.panel()
      return (this.backend = kscreen)
    } catch {
      return (this.backend = null)
    }
  }

  async state(): Promise<DisplayState> {
    const b = await this.resolve()
    if (!b) return NONE
    try {
      const p = await b.panel()
      if (!p) return { ...NONE, backend: b.id }
      const gamut = b.gamut ? await b.gamut(p.output).catch(() => null) : null
      return { backend: b.id, output: p.output, currentModeId: p.currentModeId, rates: ratesAtCurrentSize(p), gamut }
    } catch {
      return { ...NONE, backend: b.id }
    }
  }

  async setMode(modeId: string): Promise<void> {
    const b = await this.resolve()
    if (!b) throw new Error('Refresh rate switching is not supported on this desktop')
    const p = await b.panel()
    if (!p?.modes.some((m) => m.id === modeId)) throw new Error(`Unknown display mode ${modeId}`)
    await b.setMode(modeId)
  }

  async setGamut(mode: GamutMode, icc?: string): Promise<void> {
    const b = await this.resolve()
    const p = await b?.panel()
    if (!b?.setGamut || !p) throw new Error('Colour gamut switching is not supported on this desktop')
    await b.setGamut(p.output, mode, icc)
  }

  /** Switch to the lowest or highest rate at the current resolution. Returns false when already there. */
  async setExtreme(which: 'min' | 'max'): Promise<boolean> {
    const s = await this.state()
    if (s.rates.length < 2) return false
    const target = which === 'min' ? s.rates[0] : s.rates[s.rates.length - 1]
    if (target.id === s.currentModeId) return false
    await this.setMode(target.id)
    return true
  }

  /** Toggle between the lowest and highest rate. */
  async toggle(): Promise<void> {
    const s = await this.state()
    if (s.rates.length < 2) throw new Error('Only one refresh rate available')
    const max = s.rates[s.rates.length - 1]
    await this.setMode(s.currentModeId === max.id ? s.rates[0].id : max.id)
  }
}
