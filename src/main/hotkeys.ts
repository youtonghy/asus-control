// Global hotkeys through the XDG GlobalShortcuts portal (KDE Plasma, GNOME 48+,
// Hyprland and others), the same route rog-control-center uses for the
// Armoury Crate key. Each app action is one portal shortcut; the desktop
// decides which key triggers it, and the ROG key (XF86Launch3) is suggested
// for opening the window.
//
// Portal calls return a Request object whose `Response` signal carries the
// result, so the signal match is added before the call is made.

import { EventEmitter } from 'node:events'
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import dbus from 'dbus-next'
import { HOTKEY_ACTIONS, type HotkeyAction, type HotkeyBinding, type HotkeyState } from '@shared/asus'

const { Message, Variant } = dbus

const PORTAL = 'org.freedesktop.portal.Desktop'
const PORTAL_PATH = '/org/freedesktop/portal/desktop'
const IFACE_GS = 'org.freedesktop.portal.GlobalShortcuts'
const IFACE_REQUEST = 'org.freedesktop.portal.Request'
const IFACE_SESSION = 'org.freedesktop.portal.Session'
/** The installed .desktop file (package.json `desktopName`). */
const APP_ID = 'asus-control'

/** Suggested keys. KEY_PROG3 (Armoury Crate / ROG key) maps to XF86Launch3. */
const PREFERRED: Partial<Record<HotkeyAction, string>> = { 'toggle-window': 'XF86Launch3' }

type Vardict = Record<string, dbus.Variant>
type ShortcutList = [string, Vardict][]

export interface DesktopEntry {
  /** Full text of a hidden desktop entry for this app, written if none is installed. */
  content: string
  /** $APPIMAGE when running as an AppImage, to find its integration entry. */
  appImage?: string
}

/**
 * The portal only accepts an app id that has a .desktop file, and it only
 * sees files that existed when it started. Prefer the packaged
 * asus-control.desktop, then an existing entry for this app (AppImage
 * integrations name it e.g. asus-control-0.1.0.desktop). As a last resort,
 * write a hidden entry, which the portal picks up after the next login.
 */
async function resolveAppId(entry: DesktopEntry): Promise<{ id: string; created: boolean }> {
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
  const dirs = [dataHome, ...(process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':')]
    .filter(Boolean)
    .map((d) => join(d, 'applications'))
  const exists = (p: string): Promise<boolean> =>
    access(p).then(
      () => true,
      () => false
    )
  for (const d of dirs) if (await exists(join(d, `${APP_ID}.desktop`))) return { id: APP_ID, created: false }
  for (const d of dirs) {
    for (const f of await readdir(d).catch(() => [] as string[])) {
      if (!f.endsWith('.desktop')) continue
      const text = await readFile(join(d, f), 'utf8').catch(() => '')
      if (/^StartupWMClass=asus-control\s*$/m.test(text) || (entry.appImage && text.includes(entry.appImage))) {
        return { id: f.slice(0, -'.desktop'.length), created: false }
      }
    }
  }
  await mkdir(join(dataHome, 'applications'), { recursive: true })
  await writeFile(join(dataHome, 'applications', `${APP_ID}.desktop`), entry.content)
  return { id: APP_ID, created: true }
}

function bindingsFrom(list: ShortcutList): HotkeyBinding[] {
  return list
    .filter(([id]) => (HOTKEY_ACTIONS as readonly string[]).includes(id))
    .map(([id, props]) => ({ id: id as HotkeyAction, trigger: String(props.trigger_description?.value ?? '') }))
}

export class Hotkeys extends EventEmitter {
  state: HotkeyState = { status: 'off', version: 0, bindings: [] }
  private bus: dbus.MessageBus | null = null
  private session: string | null = null
  private token = 0
  private pending = new Map<string, (r: [number, Vardict]) => void>()

  private set(patch: Partial<HotkeyState>): void {
    this.state = { ...this.state, ...patch }
    this.emit('change', this.state)
  }

  /** Connect, create a session and bind any shortcuts the desktop doesn't know yet. */
  async start(describe: (a: HotkeyAction) => string, entry: DesktopEntry): Promise<void> {
    if (this.bus) return
    this.set({ status: 'starting', error: undefined })
    try {
      const bus = dbus.sessionBus()
      this.bus = bus
      bus.on('error', (e) => this.fail(e))
      bus.on('message', (m) => this.onMessage(m))
      await this.addMatch(`type='signal',interface='${IFACE_REQUEST}',member='Response'`)
      await this.addMatch(`type='signal',interface='${IFACE_GS}'`)

      // Non-sandboxed apps tell the portal who they are; portals older than
      // 1.19 lack Register and derive the id from the process instead.
      const app = await resolveAppId(entry)
      await this.call('org.freedesktop.host.portal.Registry', 'Register', 'sa{sv}', [app.id, {}]).catch((e) => {
        const err = e as { type?: string; text?: string }
        if (/UnknownMethod|UnknownInterface|UnknownObject/.test(err.type ?? '')) return
        const msg = err.text ?? String(e)
        throw new Error(app.created ? `${msg}. A desktop entry was just created; log out and back in to use hotkeys.` : msg)
      })

      const version = await this.call('org.freedesktop.DBus.Properties', 'Get', 'ss', [IFACE_GS, 'version'])
        .then((r) => Number((r?.body[0] as dbus.Variant).value))
        .catch(() => 0)
      if (!version) throw new Error('The desktop has no GlobalShortcuts portal')

      const created = await this.request('CreateSession', 'a{sv}', (opts) => [
        { ...opts, session_handle_token: new Variant('s', `asusctl_session${++this.token}`) }
      ])
      this.session = String(created.session_handle.value)

      let bindings = await this.list()
      const known = new Set(bindings.map((b) => b.id))
      if (HOTKEY_ACTIONS.some((a) => !known.has(a))) {
        // One bind per session; on KDE this shows a confirmation dialog.
        const shortcuts: ShortcutList = HOTKEY_ACTIONS.map((a) => {
          const props: Vardict = { description: new Variant('s', describe(a)) }
          if (PREFERRED[a]) props.preferred_trigger = new Variant('s', PREFERRED[a])
          return [a, props]
        })
        const bound = await this.request('BindShortcuts', 'oa(sa{sv})sa{sv}', (opts) => [
          this.session,
          shortcuts,
          '',
          opts
        ]).catch(() => null)
        bindings = bound?.shortcuts ? bindingsFrom(bound.shortcuts.value as ShortcutList) : await this.list()
      }
      this.set({ status: 'listening', version, bindings })
    } catch (e) {
      this.fail(e)
    }
  }

  async stop(): Promise<void> {
    const bus = this.bus
    if (!bus) return
    if (this.session) {
      await bus
        .call(new Message({ destination: PORTAL, path: this.session, interface: IFACE_SESSION, member: 'Close' }))
        .catch(() => {})
    }
    this.teardown()
    this.set({ status: 'off', bindings: [], error: undefined })
  }

  /** Open the desktop's shortcut settings for this app (portal version 2). */
  async configure(): Promise<void> {
    if (!this.session) throw new Error('Hotkeys are not active')
    if (this.state.version < 2) throw new Error('The desktop cannot open shortcut settings from apps')
    await this.call(IFACE_GS, 'ConfigureShortcuts', 'osa{sv}', [this.session, '', {}])
  }

  private fail(e: unknown): void {
    const msg = e instanceof Error ? e.message : String((e as { text?: string })?.text ?? e)
    this.teardown()
    this.set({ status: 'unavailable', bindings: [], error: msg })
  }

  private teardown(): void {
    try {
      this.bus?.disconnect()
    } catch {
      /* already closed */
    }
    this.bus = null
    this.session = null
    this.pending.clear()
  }

  private async list(): Promise<HotkeyBinding[]> {
    const r = await this.request('ListShortcuts', 'oa{sv}', (opts) => [this.session, opts])
    return r.shortcuts ? bindingsFrom(r.shortcuts.value as ShortcutList) : []
  }

  private onMessage(m: dbus.Message): void {
    if (m.interface === IFACE_REQUEST && m.member === 'Response') {
      const resolve = this.pending.get(m.path)
      if (resolve) {
        this.pending.delete(m.path)
        resolve(m.body as [number, Vardict])
      }
    } else if (m.interface === IFACE_GS && m.body?.[0] === this.session) {
      if (m.member === 'Activated') this.emit('activated', m.body[1] as HotkeyAction)
      else if (m.member === 'ShortcutsChanged') this.set({ bindings: bindingsFrom(m.body[1] as ShortcutList) })
    }
  }

  private addMatch(rule: string): Promise<unknown> {
    return this.bus!.call(
      new Message({
        destination: 'org.freedesktop.DBus',
        path: '/org/freedesktop/DBus',
        interface: 'org.freedesktop.DBus',
        member: 'AddMatch',
        signature: 's',
        body: [rule]
      })
    )
  }

  private call(iface: string, member: string, signature: string, body: unknown[]): Promise<dbus.Message | null> {
    return this.bus!.call(
      new Message({ destination: PORTAL, path: PORTAL_PATH, interface: iface, member, signature, body })
    )
  }

  /** Call a portal method that answers through a Request `Response` signal. */
  private async request(member: string, signature: string, args: (opts: Vardict) => unknown[]): Promise<Vardict> {
    const bus = this.bus!
    const token = `asusctl${++this.token}`
    const sender = ((bus as unknown as { name?: string }).name ?? '').replace(/^:/, '').replace(/\./g, '_')
    const expected = `${PORTAL_PATH}/request/${sender}/${token}`
    const response = new Promise<[number, Vardict]>((resolve) => this.pending.set(expected, resolve))
    const reply = await this.call(IFACE_GS, member, signature, args({ handle_token: new Variant('s', token) }))
    const handle = String(reply?.body[0] ?? expected)
    if (handle !== expected) {
      // Very old portals ignore handle_token; follow the returned path instead.
      const resolve = this.pending.get(expected)!
      this.pending.delete(expected)
      this.pending.set(handle, resolve)
    }
    const [code, results] = await response
    if (code !== 0) throw new Error(code === 1 ? 'Cancelled' : `Portal request ${member} failed`)
    return results
  }
}
