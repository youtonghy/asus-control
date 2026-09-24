// Client for the asusd system daemon (asusctl) over D-Bus.
// Keeps a cached snapshot, refreshes it when asusd emits PropertiesChanged and
// exposes typed write helpers. All hardware access goes through asusd, so this
// app needs no root privileges.

import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import dbus from 'dbus-next'
import {
  ARMOURY_ROOT,
  ASUSD_ROOT,
  ASUSD_SERVICE,
  AURA_ROOT,
  PLATFORM_WRITABLE,
  auraModeByIndex,
  gpuAttrsFor,
  validateCurve,
  type ArmouryAttr,
  type AsusSnapshot,
  type AuraDevice,
  type AuraEffect,
  type AuraPowerState,
  type FanCurve,
  type GpuMode,
  type PlatformProp,
  type PlatformState,
  type Rgb
} from '@shared/asus'

const { Variant } = dbus
type ProxyObject = dbus.ProxyObject
type ClientInterface = dbus.ClientInterface

const IFACE_PLATFORM = 'xyz.ljones.Platform'
const IFACE_FANS = 'xyz.ljones.FanCurves'
const IFACE_ARMOURY = 'xyz.ljones.AsusArmoury'
const IFACE_AURA = 'xyz.ljones.Aura'
const IFACE_PROPS = 'org.freedesktop.DBus.Properties'

type Raw = Record<string, unknown>

function unwrap(all: Record<string, dbus.Variant>): Raw {
  const out: Raw = {}
  for (const [k, v] of Object.entries(all)) out[k] = v.value
  return out
}

function errorText(e: unknown): string {
  if (e && typeof e === 'object') {
    const err = e as { text?: string; message?: string; type?: string }
    return err.text || err.message || String(e)
  }
  return String(e)
}

function parseEffect(raw: unknown): AuraEffect | null {
  if (!Array.isArray(raw) || raw.length < 6) return null
  const [mode, zone, c1, c2, speed, direction] = raw as [number, number, Rgb, Rgb, string, string]
  return { mode, zone, colour1: [...c1] as Rgb, colour2: [...c2] as Rgb, speed, direction }
}

function parseCurves(raw: unknown): FanCurve[] {
  if (!Array.isArray(raw)) return []
  return raw.map(([fan, pwm, temp, enabled]: [string, number[], number[], boolean]) => ({
    fan: fan as FanCurve['fan'],
    pwm: [...pwm],
    temp: [...temp],
    enabled
  }))
}

async function readDisplayName(id: string): Promise<string | undefined> {
  try {
    const s = await readFile(`/sys/class/firmware-attributes/asus-armoury/attributes/${id}/display_name`, 'utf8')
    return s.trim() || undefined
  } catch {
    return undefined
  }
}

export class AsusdClient extends EventEmitter {
  private bus: dbus.MessageBus | null = null
  private root: ProxyObject | null = null
  private armouryObjs = new Map<string, ProxyObject>()
  private auraObjs = new Map<string, ProxyObject>()
  private refreshTimer: NodeJS.Timeout | null = null
  private retryTimer: NodeJS.Timeout | null = null
  private product = ''
  snapshot: AsusSnapshot = {
    connected: false,
    product: '',
    platform: null,
    armoury: [],
    fans: null,
    aura: []
  }

  async start(): Promise<void> {
    this.product = await readFile('/sys/class/dmi/id/product_name', 'utf8')
      .then((s) => s.trim())
      .catch(() => 'ASUS laptop')
    await this.connect()
  }

  stop(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.bus?.disconnect()
    this.bus = null
  }

  private async connect(): Promise<void> {
    try {
      this.bus = dbus.systemBus()
      this.bus.on('error', (e) => this.fail(e))
      this.root = await this.bus.getProxyObject(ASUSD_SERVICE, ASUSD_ROOT)
      this.watch(this.root)
      await this.discoverChildren()
      await this.refresh()
    } catch (e) {
      this.fail(e)
    }
  }

  private fail(e: unknown): void {
    const msg = errorText(e)
    const errorKind = /ServiceUnknown|was not provided/.test(msg) ? 'not-running' : 'other'
    this.snapshot = { ...this.snapshot, connected: false, error: msg, errorKind, product: this.product }
    this.emit('change', this.snapshot)
    try {
      this.bus?.disconnect()
    } catch {
      /* already closed */
    }
    this.bus = null
    this.root = null
    this.armouryObjs.clear()
    this.auraObjs.clear()
    if (!this.retryTimer) {
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null
        void this.connect()
      }, 5000)
    }
  }

  private async discoverChildren(): Promise<void> {
    const bus = this.bus!
    for (const [root, map] of [
      [ARMOURY_ROOT, this.armouryObjs],
      [AURA_ROOT, this.auraObjs]
    ] as const) {
      map.clear()
      let parent: ProxyObject
      try {
        parent = await bus.getProxyObject(ASUSD_SERVICE, root)
      } catch {
        continue // feature not present on this laptop
      }
      for (const node of parent.nodes) {
        const obj = await bus.getProxyObject(ASUSD_SERVICE, node)
        map.set(node, obj)
        this.watch(obj)
      }
    }
  }

  private watch(obj: ProxyObject): void {
    try {
      obj.getInterface(IFACE_PROPS).on('PropertiesChanged', () => this.scheduleRefresh())
    } catch {
      /* object without properties */
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      void this.refresh()
    }, 120)
  }

  private props(obj: ProxyObject): ClientInterface {
    return obj.getInterface(IFACE_PROPS)
  }

  async refresh(): Promise<AsusSnapshot> {
    if (!this.root) return this.snapshot
    try {
      const platform = await this.readPlatform()
      const [armoury, aura] = await Promise.all([this.readArmoury(), this.readAura()])
      const fans = platform ? await this.readFanCurves(platform.profile).catch(() => null) : null
      this.snapshot = { connected: true, product: this.product, platform, armoury, fans, aura }
      this.emit('change', this.snapshot)
    } catch (e) {
      this.fail(e)
    }
    return this.snapshot
  }

  private async readPlatform(): Promise<PlatformState | null> {
    let raw: Raw
    try {
      raw = unwrap(await this.props(this.root!).GetAll(IFACE_PLATFORM))
    } catch {
      return null
    }
    const supported: string[] = await this.root!
      .getInterface(IFACE_PLATFORM)
      .SupportedProperties()
      .catch(() => [])
    const n = (k: string, d = 0): number => (typeof raw[k] === 'number' ? (raw[k] as number) : d)
    const b = (k: string): boolean => raw[k] === true
    return {
      version: String(raw.Version ?? ''),
      profile: n('PlatformProfile'),
      choices: (raw.PlatformProfileChoices as number[] | undefined) ?? [],
      profileOnAc: n('PlatformProfileOnAc'),
      profileOnBattery: n('PlatformProfileOnBattery'),
      changeProfileOnAc: b('ChangePlatformProfileOnAc'),
      changeProfileOnBattery: b('ChangePlatformProfileOnBattery'),
      chargeLimit: supported.includes('ChargeControlEndThreshold') ? n('ChargeControlEndThreshold', 100) : null,
      linkedEpp: b('PlatformProfileLinkedEpp'),
      epp: {
        quiet: n('ProfileQuietEpp'),
        balanced: n('ProfileBalancedEpp'),
        performance: n('ProfilePerformanceEpp')
      },
      pptGroup: b('EnablePptGroup'),
      disableNvidiaPowerdOnBattery: b('DisableNvidiaPowerdOnBattery')
    }
  }

  private async readArmoury(): Promise<ArmouryAttr[]> {
    const attrs = await Promise.all(
      [...this.armouryObjs].map(async ([path, obj]) => {
        const id = path.slice(path.lastIndexOf('/') + 1)
        try {
          const r = unwrap(await this.props(obj).GetAll(IFACE_ARMOURY))
          const attr: ArmouryAttr = {
            id,
            path,
            current: r.CurrentValue as number,
            default: r.DefaultValue as number,
            min: r.MinValue as number,
            max: r.MaxValue as number,
            step: r.ScalarIncrement as number,
            possible: (r.PossibleValues as number[]) ?? [],
            queued: (r.QueuedGpuValue as number) ?? -1,
            displayName: await readDisplayName(id)
          }
          return attr
        } catch {
          return null
        }
      })
    )
    return attrs.filter((a): a is ArmouryAttr => a !== null).sort((a, b) => a.id.localeCompare(b.id))
  }

  private async readAura(): Promise<AuraDevice[]> {
    const devices = await Promise.all(
      [...this.auraObjs].map(async ([path, obj]) => {
        const props = this.props(obj)
        // Read individually: LedMode* getters use try_lock in asusd and can fail
        // transiently, which would otherwise fail the whole GetAll.
        const get = async (k: string): Promise<unknown> => {
          try {
            return (await props.Get(IFACE_AURA, k)).value
          } catch {
            return undefined
          }
        }
        const [brightness, deviceType, modeData, power, supModes, supBright] = await Promise.all(
          ['Brightness', 'DeviceType', 'LedModeData', 'LedPower', 'SupportedBasicModes', 'SupportedBrightness'].map(get)
        )
        const all: Record<number, AuraEffect> = {}
        try {
          const reply = (await obj.getInterface(IFACE_AURA).AllModeData()) as Record<string, unknown>
          for (const v of Object.values(reply)) {
            const eff = parseEffect(v)
            // AllModeData serialises modes by variant index; normalise to repr.
            if (eff) {
              const def = auraModeByIndex(eff.mode)
              if (def) all[def.repr] = { ...eff, mode: def.repr }
            }
          }
        } catch {
          /* optional */
        }
        const powerStates: AuraPowerState[] = Array.isArray(power)
          ? ((power as unknown[])[0] as [number, boolean, boolean, boolean, boolean][]).map(
              ([zone, boot, awake, sleep, shutdown]) => ({ zone, boot, awake, sleep, shutdown })
            )
          : []
        const dev: AuraDevice = {
          path,
          id: path.slice(path.lastIndexOf('/') + 1),
          deviceType: (deviceType as number) ?? 0,
          brightness: (brightness as number) ?? 0,
          supportedBrightness: (supBright as number[]) ?? [],
          supportedModes: (supModes as number[]) ?? [],
          effect: parseEffect(modeData),
          modeData: all,
          power: powerStates
        }
        return dev
      })
    )
    return devices
  }

  async readFanCurves(profile: number): Promise<FanCurve[]> {
    if (!this.root) throw new Error('Not connected to asusd')
    return parseCurves(await this.root.getInterface(IFACE_FANS).FanCurveData(profile))
  }

  // ------------------------------------------------------------ writes

  private requireRoot(): ProxyObject {
    if (!this.root) throw new Error('Not connected to asusd')
    return this.root
  }

  /** Run a write; D-Bus errors are rethrown with just asusd's message, which the UI localizes around. */
  private async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      const r = await fn()
      this.scheduleRefresh()
      return r
    } catch (e) {
      throw new Error(errorText(e))
    }
  }

  setPlatform(prop: PlatformProp, value: number | boolean): Promise<void> {
    const sig = PLATFORM_WRITABLE[prop]
    if (!sig) throw new Error(`Property ${prop} is not writable`)
    return this.wrap(() =>
      this.props(this.requireRoot()).Set(IFACE_PLATFORM, prop, new Variant(sig, sig === 'b' ? Boolean(value) : Number(value)))
    )
  }

  oneShotFullCharge(): Promise<void> {
    return this.wrap(() => this.requireRoot().getInterface(IFACE_PLATFORM).OneShotFullCharge())
  }

  private armouryObj(id: string): ProxyObject {
    const obj = this.armouryObjs.get(`${ARMOURY_ROOT}/${id}`)
    if (!obj) throw new Error(`Firmware attribute ${id} is not available`)
    return obj
  }

  setArmoury(id: string, value: number): Promise<void> {
    return this.wrap(() =>
      this.props(this.armouryObj(id)).Set(IFACE_ARMOURY, 'CurrentValue', new Variant('i', Math.round(value)))
    )
  }

  restoreArmoury(id: string): Promise<void> {
    return this.wrap(() => this.armouryObj(id).getInterface(IFACE_ARMOURY).RestoreDefault())
  }

  async setGpuMode(mode: GpuMode): Promise<void> {
    const hasMux = this.armouryObjs.has(`${ARMOURY_ROOT}/gpu_mux_mode`)
    // Same order as rog-control-center: dgpu_disable first, then the MUX.
    for (const [id, value] of Object.entries(gpuAttrsFor(mode, hasMux))) {
      await this.setArmoury(id, value)
    }
  }

  setFanCurve(profile: number, curve: FanCurve): Promise<void> {
    const err = validateCurve(curve)
    // The UI validates first; this only guards against a buggy caller.
    if (err) throw new Error(`Invalid fan curve: ${JSON.stringify(err)}`)
    return this.wrap(() =>
      this.requireRoot()
        .getInterface(IFACE_FANS)
        .SetFanCurve(profile, [curve.fan, curve.pwm, curve.temp, curve.enabled])
    )
  }

  setFanCurvesEnabled(profile: number, enabled: boolean): Promise<void> {
    return this.wrap(() =>
      this.requireRoot().getInterface(IFACE_FANS).SetFanCurvesEnabled(profile, enabled)
    )
  }

  resetFanCurves(profile: number): Promise<void> {
    return this.wrap(() =>
      this.requireRoot().getInterface(IFACE_FANS).SetCurvesToDefaults(profile)
    )
  }

  private auraObj(path: string): ProxyObject {
    const obj = this.auraObjs.get(path)
    if (!obj) throw new Error(`Aura device ${path} is not available`)
    return obj
  }

  setAuraBrightness(path: string, value: number): Promise<void> {
    return this.wrap(() =>
      this.props(this.auraObj(path)).Set(IFACE_AURA, 'Brightness', new Variant('u', value))
    )
  }

  setAuraEffect(path: string, e: AuraEffect): Promise<void> {
    return this.wrap(() =>
      this.props(this.auraObj(path)).Set(
        IFACE_AURA,
        'LedModeData',
        new Variant('(uu(yyy)(yyy)ss)', [e.mode, e.zone, e.colour1, e.colour2, e.speed, e.direction])
      )
    )
  }

  setAuraPower(path: string, states: AuraPowerState[]): Promise<void> {
    return this.wrap(() =>
      this.props(this.auraObj(path)).Set(
        IFACE_AURA,
        'LedPower',
        new Variant('(a(ubbbb))', [states.map((s) => [s.zone, s.boot, s.awake, s.sleep, s.shutdown])])
      )
    )
  }
}
