// Lightweight sensor polling straight from sysfs (no root needed).
// The NVIDIA dGPU is only queried while it is already awake: asking
// nvidia-smi on a runtime-suspended GPU would power it up and drain battery.

import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import type { Sensors } from '@shared/asus'

const run = promisify(execFile)

async function read(path: string): Promise<string | null> {
  try {
    return (await readFile(path, 'utf8')).trim()
  } catch {
    return null
  }
}

async function readNum(path: string): Promise<number | null> {
  const s = await read(path)
  if (s === null) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

interface Discovered {
  cpuTempPath: string | null
  igpuTempPath: string | null
  fans: { label: string; path: string }[]
  battery: string | null
  ac: string | null
  dgpuPci: string | null
  dgpuName: string | null
}

const FAN_LABELS: Record<string, string> = { cpu_fan: 'CPU', gpu_fan: 'GPU', mid_fan: 'Mid' }

async function discover(): Promise<Discovered> {
  const d: Discovered = {
    cpuTempPath: null,
    igpuTempPath: null,
    fans: [],
    battery: null,
    ac: null,
    dgpuPci: null,
    dgpuName: null
  }

  const hwmonRoot = '/sys/class/hwmon'
  for (const h of await readdir(hwmonRoot).catch(() => [])) {
    const dir = `${hwmonRoot}/${h}`
    const name = await read(`${dir}/name`)
    if (name === 'k10temp' || name === 'coretemp' || name === 'zenpower') {
      d.cpuTempPath ??= `${dir}/temp1_input`
    } else if (name === 'amdgpu' || name === 'i915' || name === 'xe') {
      // Integrated GPU. A discrete AMD GPU would also be called amdgpu, but
      // on ASUS laptops the dGPU is NVIDIA in practice.
      d.igpuTempPath ??= `${dir}/temp1_input`
    } else if (name === 'asus') {
      const files = await readdir(dir)
      for (const f of files.filter((x) => /^fan\d+_input$/.test(x)).sort()) {
        const idx = f.match(/\d+/)![0]
        const raw = (await read(`${dir}/fan${idx}_label`)) ?? `fan${idx}`
        d.fans.push({ label: FAN_LABELS[raw] ?? raw, path: `${dir}/${f}` })
      }
    }
  }

  const psRoot = '/sys/class/power_supply'
  for (const p of await readdir(psRoot).catch(() => [])) {
    const type = await read(`${psRoot}/${p}/type`)
    if (type === 'Battery' && (await read(`${psRoot}/${p}/scope`)) !== 'Device') d.battery ??= `${psRoot}/${p}`
    if (type === 'Mains') d.ac ??= `${psRoot}/${p}`
  }

  const pciRoot = '/sys/bus/pci/devices'
  for (const dev of await readdir(pciRoot).catch(() => [])) {
    const vendor = await read(`${pciRoot}/${dev}/vendor`)
    const cls = await read(`${pciRoot}/${dev}/class`)
    if (vendor === '0x10de' && cls?.startsWith('0x03')) {
      d.dgpuPci = `${pciRoot}/${dev}`
      break
    }
  }
  return d
}

export class SensorPoller {
  private found: Promise<Discovered> | null = null
  private lastNvidia = 0
  private nvidia: { temp: number | null; name: string | null } = { temp: null, name: null }

  /** Re-scan sysfs, e.g. after a GPU mode change adds or removes the dGPU. */
  rediscover(): void {
    this.found = null
  }

  async read(): Promise<Sensors> {
    this.found ??= discover()
    const d = await this.found

    const [cpuTemp, igpuTemp] = await Promise.all([
      d.cpuTempPath ? readNum(d.cpuTempPath) : null,
      d.igpuTempPath ? readNum(d.igpuTempPath) : null
    ])

    const fans = await Promise.all(
      d.fans.map(async (f) => ({ label: f.label, rpm: (await readNum(f.path)) ?? 0 }))
    )

    let dgpu: Sensors['dgpu'] = 'absent'
    if (d.dgpuPci) {
      const status = await read(`${d.dgpuPci}/power/runtime_status`)
      if (status === null) {
        // Device vanished (e.g. dgpu_disable took effect); look again next time.
        this.rediscover()
      } else {
        dgpu = status === 'active' ? 'active' : 'suspended'
      }
    }
    if (dgpu === 'active' && Date.now() - this.lastNvidia > 4000) {
      this.lastNvidia = Date.now()
      this.nvidia = await queryNvidia().catch(() => ({ temp: null, name: this.nvidia.name }))
    }

    return {
      cpuTemp: cpuTemp === null ? null : cpuTemp / 1000,
      igpuTemp: igpuTemp === null ? null : igpuTemp / 1000,
      dgpuTemp: dgpu === 'active' ? this.nvidia.temp : null,
      dgpu,
      dgpuName: this.nvidia.name,
      fans,
      cpuMhz: await cpuMhz(),
      battery: d.battery ? await battery(d.battery) : null,
      acOnline: d.ac ? (await read(`${d.ac}/online`)) === '1' : null
    }
  }
}

async function queryNvidia(): Promise<{ temp: number | null; name: string | null }> {
  const { stdout } = await run('nvidia-smi', ['--query-gpu=temperature.gpu,name', '--format=csv,noheader,nounits'], {
    timeout: 3000
  })
  const [temp, name] = stdout.split('\n')[0].split(',').map((s) => s.trim())
  const t = Number(temp)
  return { temp: Number.isFinite(t) ? t : null, name: name || null }
}

async function cpuMhz(): Promise<number | null> {
  const root = '/sys/devices/system/cpu'
  const cpus = (await readdir(root).catch(() => [])).filter((c) => /^cpu\d+$/.test(c))
  const vals = (await Promise.all(cpus.map((c) => readNum(`${root}/${c}/cpufreq/scaling_cur_freq`)))).filter(
    (v): v is number => v !== null
  )
  if (!vals.length) return null
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length / 1000)
}

async function battery(dir: string): Promise<Sensors['battery']> {
  const [capacity, status, powerNow, currentNow, voltageNow, full, design, cycles] = await Promise.all([
    readNum(`${dir}/capacity`),
    read(`${dir}/status`),
    readNum(`${dir}/power_now`),
    readNum(`${dir}/current_now`),
    readNum(`${dir}/voltage_now`),
    readNum(`${dir}/energy_full`).then((v) => v ?? readNum(`${dir}/charge_full`)),
    readNum(`${dir}/energy_full_design`).then((v) => v ?? readNum(`${dir}/charge_full_design`)),
    readNum(`${dir}/cycle_count`)
  ])
  if (capacity === null) return null
  let watts: number | null = null
  if (powerNow !== null) watts = powerNow / 1e6
  else if (currentNow !== null && voltageNow !== null) watts = (currentNow * voltageNow) / 1e12
  if (watts !== null) {
    if (status === 'Discharging') watts = -Math.abs(watts)
    else if (status !== 'Charging') watts = 0
    watts = Math.round(watts * 10) / 10
  }
  return {
    percent: capacity,
    status: status ?? 'Unknown',
    watts,
    health: full && design ? Math.round((full / design) * 1000) / 10 : null,
    cycles: cycles && cycles > 0 ? cycles : null
  }
}
