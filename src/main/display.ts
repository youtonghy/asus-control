// Internal panel refresh-rate switching (G-Helper's "Screen" section).
// Uses kscreen-doctor on KDE Plasma; other desktops report backend "none".

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { DisplayMode, DisplayState } from '@shared/asus'

const run = promisify(execFile)

interface KScreenMode {
  id: string
  size: { width: number; height: number }
  refreshRate: number
}
interface KScreenOutput {
  id: number
  name: string
  enabled: boolean
  connected?: boolean
  currentModeId: string
  modes: KScreenMode[]
}

const NONE: DisplayState = { backend: 'none', output: null, currentModeId: null, rates: [] }

export class DisplayControl {
  private available: boolean | null = null

  private async kscreen(): Promise<KScreenOutput | null> {
    if (this.available === false) return null
    try {
      const { stdout } = await run('kscreen-doctor', ['-j'], { timeout: 4000 })
      this.available = true
      const outputs: KScreenOutput[] = JSON.parse(stdout).outputs ?? []
      // The laptop panel is eDP; fall back to the first enabled output.
      return (
        outputs.find((o) => o.enabled && /^eDP/i.test(o.name)) ??
        outputs.find((o) => o.enabled) ??
        null
      )
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') this.available = false
      return null
    }
  }

  async state(): Promise<DisplayState> {
    const out = await this.kscreen()
    if (!out) return NONE
    const current = out.modes.find((m) => String(m.id) === String(out.currentModeId))
    if (!current) return NONE
    // One entry per distinct refresh rate at the current resolution.
    const byRate = new Map<number, DisplayMode>()
    for (const m of out.modes) {
      if (m.size.width !== current.size.width || m.size.height !== current.size.height) continue
      const rounded = Math.round(m.refreshRate)
      const mode = { id: String(m.id), width: m.size.width, height: m.size.height, refresh: m.refreshRate }
      if (String(m.id) === String(out.currentModeId) || !byRate.has(rounded)) byRate.set(rounded, mode)
    }
    return {
      backend: 'kscreen',
      output: out.name,
      currentModeId: String(out.currentModeId),
      rates: [...byRate.values()].sort((a, b) => a.refresh - b.refresh)
    }
  }

  async setMode(modeId: string): Promise<void> {
    const out = await this.kscreen()
    if (!out) throw new Error('Refresh rate switching needs KDE Plasma (kscreen-doctor)')
    if (!out.modes.some((m) => String(m.id) === modeId)) throw new Error(`Unknown display mode ${modeId}`)
    await run('kscreen-doctor', [`output.${out.name}.mode.${modeId}`], { timeout: 8000 })
  }
}
