import type { Sensors } from './asus.ts'
import { profileName, type Translator } from './i18n/index.ts'

/**
 * Multi-line tray tooltip: mode, CPU and GPU temperature, then every fan.
 * Linux tray icons (StatusNotifierItem) get no hover event, so this is kept
 * up to date in the background and the panel shows it on hover.
 */
export function trayTooltip(t: Translator, profile: number | null, s: Sensors | null): string {
  const lines = [profile === null ? t('app.name') : t('tray.tipTitle', { mode: profileName(t, profile) })]
  if (!s) return lines[0]

  const temp = (name: string, v: number): string => t('tray.tipTemp', { name, temp: Math.round(v) })
  if (s.cpuTemp !== null) lines.push(temp(t('live.cpu'), s.cpuTemp))
  // Show the dGPU only while it is awake; reading it otherwise would wake it.
  if (s.dgpu === 'active' && s.dgpuTemp !== null) lines.push(temp(t('live.dgpu'), s.dgpuTemp))
  else if (s.igpuTemp !== null) lines.push(temp(t('live.igpu'), s.igpuTemp))

  for (const f of s.fans) {
    const name = t('live.fan', { name: t.dyn(`fan.${f.label}`, f.label) })
    lines.push(t('tray.tipFan', { name, rpm: f.rpm }))
  }
  return lines.join('\n')
}
