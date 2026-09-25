import { relaunchIsolatedIfNeeded } from './gpu-isolation'
import { join } from 'node:path'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { BrowserWindow, Menu, Notification, Tray, app, dialog, ipcMain, nativeImage, shell } from 'electron'
import {
  AURA_MODES,
  HOTKEY_ACTIONS,
  availableGpuModes,
  gpuModeFrom,
  sortProfiles,
  type AppSettings,
  type AsusAction,
  type AsusSnapshot,
  type HistorySample,
  type HotkeyAction,
  type Sensors
} from '@shared/asus'
import { perKeyPackets, zonedPacket } from '@shared/aura-advanced'
import { profileName, resolveLocale, translator, type Translator } from '@shared/i18n'
// Bundled by electron-vite, so the path is valid in dev, unpacked and packaged builds.
import { trayTooltip } from '@shared/tray-tooltip'
import iconPath from '../../resources/icon.png?asset'
import { AsusdClient } from './asusd'
import { SensorPoller } from './sensors'
import { DisplayControl } from './display'
import { Hotkeys } from './hotkeys'
import { auraAdvanced } from './aura-support'

const asusd = new AsusdClient()
const sensors = new SensorPoller()
const display = new DisplayControl()
const hotkeys = new Hotkeys()

let win: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let sensorTimer: NodeJS.Timeout | null = null
let lastProfile: number | null = null

const DEFAULT_SETTINGS: AppSettings = {
  language: 'system',
  closeToTray: true,
  startHidden: false,
  autostart: false,
  autoRefresh: false,
  autoOverdrive: false,
  hotkeys: false,
  customLighting: {},
  customLightingActive: false
}
let settings: AppSettings = { ...DEFAULT_SETTINGS }
/** Translator for the main process (tray, notifications), following the language setting. */
let cachedT: Translator | null = null
function tr(): Translator {
  const locale = resolveLocale(settings.language, app.getLocale())
  if (cachedT?.locale !== locale) cachedT = translator(locale)
  return cachedT
}

const settingsPath = (): string => join(app.getPath('userData'), 'settings.json')
const autostartPath = join(homedir(), '.config', 'autostart', 'asus-control.desktop')


async function loadSettings(): Promise<void> {
  try {
    settings = { ...DEFAULT_SETTINGS, ...JSON.parse(await readFile(settingsPath(), 'utf8')) }
  } catch {
    settings = { ...DEFAULT_SETTINGS }
  }
}

async function saveSettings(next: Partial<AppSettings>): Promise<AppSettings> {
  settings = { ...settings, ...next }
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(settingsPath(), JSON.stringify(settings, null, 2))
  if ('autostart' in next) await applyAutostart(settings.autostart)
  if ('language' in next) {
    tray?.setContextMenu(buildTrayMenu(asusd.snapshot))
    updateTrayTooltip()
  }
  if (next.hotkeys === true) startHotkeys()
  if (next.hotkeys === false) void hotkeys.stop()
  // Turning an automation on applies it straight away, like G-Helper.
  if ((next.autoRefresh || next.autoOverdrive) && lastSensors?.acOnline != null) {
    void applyPowerAutomation(lastSensors.acOnline, { refresh: !!next.autoRefresh, overdrive: !!next.autoOverdrive })
  }
  win?.webContents.send('settings', settings)
  return settings
}

/** A desktop entry that launches this copy of the app with `args`. */
function desktopEntry(args: string, extra: string[]): string {
  const exec = process.env.APPIMAGE ?? process.execPath
  const appPath = app.isPackaged ? '' : ` ${JSON.stringify(app.getAppPath())}`
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=ASUS Control',
    'Comment=Control panel for ASUS laptops',
    `Exec="${exec}"${appPath}${args}`,
    'Icon=asus-control',
    'StartupWMClass=asus-control',
    ...extra,
    ''
  ].join('\n')
}

async function applyAutostart(enabled: boolean): Promise<void> {
  if (!enabled) {
    await rm(autostartPath, { force: true })
    return
  }
  await mkdir(join(homedir(), '.config', 'autostart'), { recursive: true })
  await writeFile(autostartPath, desktopEntry(' --hidden', ['X-GNOME-Autostart-enabled=true']))
}

function startHotkeys(): void {
  void hotkeys.start(describeHotkey, {
    content: desktopEntry('', ['NoDisplay=true']),
    appImage: process.env.APPIMAGE
  })
}

function createWindow(show: boolean): void {
  win = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 420,
    minHeight: 520,
    show: false,
    title: tr()('app.name'),
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => {
    if (show) win?.show()
  })
  win.on('show', scheduleSensors)
  win.on('hide', scheduleSensors)
  win.on('close', (e) => {
    if (!quitting && settings.closeToTray && tray) {
      e.preventDefault()
      win?.hide()
    }
  })
  win.on('closed', () => {
    win = null
    scheduleSensors()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

function showWindow(): void {
  if (!win) createWindow(true)
  else {
    win.show()
    win.focus()
  }
}

// Sensors refresh every 2 s while the window is visible, and every 5 s while
// only the tray is around, just enough to keep its hover tooltip current.
// sysfs reads are cheap, and SensorPoller never wakes a sleeping dGPU.
let sensorPeriod = 0
let lastSensors: Sensors | null = null
let lastTooltip = ''

// The last 30 minutes of readings for the Monitor page. Samples come at the
// sensor period, so they are denser while the window is open.
const HISTORY_MS = 30 * 60 * 1000
const history: HistorySample[] = []

function record(s: Sensors): void {
  const now = Date.now()
  history.push({
    t: now,
    cpu: s.cpuTemp,
    gpu: s.dgpu === 'active' ? s.dgpuTemp : s.igpuTemp,
    fans: s.fans.map((f) => f.rpm),
    watts: s.battery?.watts ?? null,
    mhz: s.cpuMhz
  })
  while (history.length && history[0].t < now - HISTORY_MS) history.shift()
}

async function sensorTick(): Promise<void> {
  try {
    const prevAc = lastSensors?.acOnline ?? null
    lastSensors = await sensors.read()
    record(lastSensors)
    if (win?.isVisible()) win.webContents.send('sensors', lastSensors)
    updateTrayTooltip()
    const ac = lastSensors.acOnline
    if (ac !== null && ac !== prevAc) {
      void applyPowerAutomation(ac, { refresh: settings.autoRefresh, overdrive: settings.autoOverdrive })
    }
  } catch {
    /* transient sysfs errors */
  }
}

/** G-Helper's screen "Auto": lowest refresh rate and no overdrive on battery. */
async function applyPowerAutomation(ac: boolean, what: { refresh: boolean; overdrive: boolean }): Promise<void> {
  if (what.refresh) {
    try {
      if (await display.setExtreme(ac ? 'max' : 'min')) pushDisplay()
    } catch (e) {
      notifyError(e)
    }
  }
  const od = asusd.snapshot.armoury.find((a) => a.id === 'panel_overdrive')
  if (what.overdrive && od && od.current !== (ac ? 1 : 0)) {
    await asusd.setArmoury('panel_overdrive', ac ? 1 : 0).catch(notifyError)
  }
}

function pushDisplay(): void {
  void display.state().then((s) => win?.webContents.send('display', s))
}

function updateTrayTooltip(): void {
  if (!tray) return
  const tip = trayTooltip(tr(), asusd.snapshot.platform?.profile ?? null, lastSensors)
  // Each change is a D-Bus property update; skip the ones that change nothing.
  if (tip !== lastTooltip) {
    tray.setToolTip(tip)
    lastTooltip = tip
  }
}

function scheduleSensors(): void {
  const period = win?.isVisible() ? 2000 : tray ? 5000 : 0
  if (period === sensorPeriod) return
  if (sensorTimer) clearInterval(sensorTimer)
  sensorTimer = null
  sensorPeriod = period
  if (!period) return
  void sensorTick()
  sensorTimer = setInterval(sensorTick, period)
}

function buildTrayMenu(snap: AsusSnapshot): Menu {
  const t = tr()
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: snap.product || t('app.name'), enabled: false },
    { type: 'separator' }
  ]
  if (snap.platform) {
    const p = snap.platform
    for (const choice of sortProfiles(p.choices)) {
      items.push({
        label: profileName(t, choice),
        type: 'radio',
        checked: choice === p.profile,
        click: () => void asusd.setPlatform('PlatformProfile', choice).catch(notifyError)
      })
    }
    items.push({ type: 'separator' })
  }
  const dgpu = snap.armoury.find((a) => a.id === 'dgpu_disable')
  const mux = snap.armoury.find((a) => a.id === 'gpu_mux_mode')
  if (dgpu || mux) {
    const current = gpuModeFrom(dgpu?.current, mux?.current)
    items.push({
      label: t('gpu.title'),
      submenu: availableGpuModes(!!dgpu, !!mux).map((m) => ({
        label: t(`gpu.${m}`),
        type: 'radio' as const,
        checked: m === current,
        click: () => void runAction({ type: 'setGpuMode', mode: m }).catch(notifyError)
      }))
    })
    items.push({ type: 'separator' })
  }
  if (!snap.connected) items.push({ label: t('tray.notConnected'), enabled: false }, { type: 'separator' })
  items.push(
    { label: t('tray.open'), click: showWindow },
    {
      label: t('tray.quit'),
      click: () => {
        quitting = true
        app.quit()
      }
    }
  )
  return Menu.buildFromTemplate(items)
}

function createTray(): void {
  const img = nativeImage.createFromPath(iconPath)
  if (img.isEmpty()) {
    // Without a tray, closing the window has to quit (see the close handler),
    // so make a missing icon loud instead of silently losing close-to-tray.
    console.error(`Tray icon could not be loaded from ${iconPath}; close-to-tray is disabled`)
    return
  }
  tray = new Tray(img.resize({ width: 22, height: 22 }))
  tray.on('click', showWindow)
  scheduleSensors()
  tray.setContextMenu(buildTrayMenu(asusd.snapshot))
}

function notifyInfo(body: string): void {
  if (win?.isFocused()) win.webContents.send('toast', { kind: 'info', text: body })
  else if (Notification.isSupported()) new Notification({ title: tr()('app.name'), body, silent: true }).show()
}

function notifyError(e: unknown): void {
  const msg = tr()('error.failed', { message: e instanceof Error ? e.message : String(e) })
  if (win?.isVisible()) win.webContents.send('toast', { kind: 'error', text: msg })
  else if (Notification.isSupported()) new Notification({ title: tr()('app.name'), body: msg }).show()
}

async function runAction(a: AsusAction): Promise<unknown> {
  switch (a.type) {
    case 'setPlatform':
      return asusd.setPlatform(a.prop, a.value)
    case 'setArmoury':
      return asusd.setArmoury(a.id, a.value)
    case 'restoreArmoury':
      return asusd.restoreArmoury(a.id)
    case 'setGpuMode':
      await asusd.setGpuMode(a.mode)
      sensors.rediscover()
      return
    case 'setFanCurve':
      return asusd.setFanCurve(a.profile, a.curve)
    case 'setFanCurvesEnabled':
      return asusd.setFanCurvesEnabled(a.profile, a.enabled)
    case 'resetFanCurves':
      return asusd.resetFanCurves(a.profile)
    case 'getFanCurves':
      return asusd.readFanCurves(a.profile)
    case 'setAuraBrightness':
      return asusd.setAuraBrightness(a.path, a.value)
    case 'setAuraEffect':
      if (settings.customLightingActive) await saveSettings({ customLightingActive: false })
      return asusd.setAuraEffect(a.path, a.effect)
    case 'setAuraPower':
      return asusd.setAuraPower(a.path, a.power)
    case 'oneShotFullCharge':
      return asusd.oneShotFullCharge()
    case 'setDisplayMode':
      return display.setMode(a.modeId)
    case 'setGamut':
      await display.setGamut(a.mode, a.icc)
      return pushDisplay()
    case 'setAnime':
      return asusd.setAnime(a.prop, a.value)
    case 'setSlash':
      return asusd.setSlash(a.prop, a.value)
    case 'setAuraDirect':
      return setCustomLighting(a.path, a.colours)
    default:
      throw new Error(`Unknown action ${(a as { type: string }).type}`)
  }
}

async function setCustomLighting(path: string, colours: AppSettings['customLighting']): Promise<void> {
  const adv = (await auraAdvanced(asusd.snapshot.aura)).find((a) => a.path === path)
  if (!adv) throw new Error('This keyboard does not support per-key or zone colours')
  const packets = adv.kind === 'per-key' ? perKeyPackets(colours) : zonedPacket(colours, adv.zones.length > 1)
  await asusd.setAuraDirect(path, packets)
  await saveSettings({ customLighting: colours, customLightingActive: true })
}

// ---------------------------------------------------------------- hotkeys

function describeHotkey(a: HotkeyAction): string {
  return tr()(`hotkey.${a}`)
}

const next = <T>(list: T[], current: T): T => list[(list.indexOf(current) + 1) % list.length]

async function runHotkey(a: HotkeyAction): Promise<void> {
  const t = tr()
  const snap = asusd.snapshot
  const kbd = snap.aura[0]
  switch (a) {
    case 'toggle-window':
      if (win?.isVisible() && win.isFocused()) win.hide()
      else showWindow()
      return
    case 'cycle-profile':
      // The profile notification comes from onSnapshot.
      return asusd.nextPlatformProfile()
    case 'cycle-kbd-brightness': {
      if (!kbd) return
      const levels = [...(kbd.supportedBrightness.length ? kbd.supportedBrightness : [0, 1, 2, 3])].sort()
      const level = next(levels, kbd.brightness)
      await asusd.setAuraBrightness(kbd.path, level)
      return notifyInfo(t('hotkey.kbdBrightness', { level: t.dyn(`aura.brightness.${level}`, String(level)) }))
    }
    case 'cycle-aura-mode': {
      if (!kbd?.effect) return
      const modes = AURA_MODES.filter((m) => kbd.supportedModes.includes(m.repr))
      if (!modes.length) return
      const mode = modes[(modes.findIndex((m) => m.repr === kbd.effect!.mode) + 1) % modes.length]
      await runAction({
        type: 'setAuraEffect',
        path: kbd.path,
        effect: kbd.modeData[mode.repr] ?? { ...kbd.effect, mode: mode.repr }
      })
      return notifyInfo(t('hotkey.auraMode', { mode: t.dyn(`aura.mode.${mode.slug}`, mode.slug) }))
    }
    case 'toggle-refresh': {
      await display.toggle()
      const s = await display.state()
      win?.webContents.send('display', s)
      const cur = s.rates.find((r) => r.id === s.currentModeId)
      if (cur) notifyInfo(t('hotkey.refresh', { rate: Math.round(cur.refresh) }))
      return
    }
    case 'toggle-matrix':
      if (snap.anime) return asusd.setAnime('EnableDisplay', !snap.anime.displayEnabled)
      if (snap.slash) return asusd.setSlash('Enabled', !snap.slash.enabled)
      return
  }
}

/** `--action=<id>` / `--action <id>` from the command line, for desktops without the portal. */
function cliAction(argv: string[]): HotkeyAction | null {
  const i = argv.findIndex((a) => a === '--action' || a.startsWith('--action='))
  if (i < 0) return null
  const id = argv[i].includes('=') ? argv[i].slice('--action='.length) : argv[i + 1]
  return (HOTKEY_ACTIONS as readonly string[]).includes(id) ? (id as HotkeyAction) : null
}

function registerIpc(): void {
  ipcMain.handle('asus:snapshot', () => asusd.snapshot)
  ipcMain.handle('asus:refresh', () => asusd.refresh())
  ipcMain.handle('asus:action', (_e, a: AsusAction) => runAction(a))
  ipcMain.handle('display:state', () => display.state())
  ipcMain.handle('sensors:history', () => history)
  ipcMain.handle('display:pickIcc', async () => {
    const opts: Electron.OpenDialogOptions = {
      title: tr()('screen.pickIcc'),
      defaultPath: '/usr/share/color/icc',
      properties: ['openFile'],
      filters: [{ name: 'ICC', extensions: ['icc', 'icm', 'ICC', 'ICM'] }]
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('aura:advanced', () => auraAdvanced(asusd.snapshot.aura))
  ipcMain.handle('hotkeys:state', () => hotkeys.state)
  ipcMain.handle('hotkeys:configure', () => hotkeys.configure())
  ipcMain.handle('hotkeys:run', (_e, a: HotkeyAction) => runHotkey(a))
  ipcMain.handle('settings:get', () => settings)
  ipcMain.handle('settings:set', (_e, next: Partial<AppSettings>) => saveSettings(next))
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    desktop: process.env.XDG_CURRENT_DESKTOP ?? ''
  }))
  ipcMain.handle('app:open', (_e, url: string) => {
    if (/^https:\/\//.test(url)) return shell.openExternal(url)
  })
}

function onSnapshot(snap: AsusSnapshot): void {
  win?.webContents.send('asus:state', snap)
  tray?.setContextMenu(buildTrayMenu(snap))
  updateTrayTooltip()
  const profile = snap.platform?.profile ?? null
  // Fn+F5 cycles profiles in firmware; show a toast like G-Helper does.
  if (lastProfile !== null && profile !== null && profile !== lastProfile && !win?.isFocused()) {
    if (Notification.isSupported()) {
      const t = tr()
      new Notification({ title: t('perf.title'), body: profileName(t, profile), silent: true }).show()
    }
  }
  lastProfile = profile
}

// Must happen before the app is ready, i.e. before Chromium spawns its GPU process.
if (relaunchIsolatedIfNeeded()) {
  app.exit(0)
} else if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const action = cliAction(argv)
    if (action) void runHotkey(action).catch(notifyError)
    else showWindow()
  })
  app.whenReady().then(async () => {
    await loadSettings()
    registerIpc()
    asusd.on('change', onSnapshot)
    hotkeys.on('change', (s) => win?.webContents.send('hotkeys', s))
    hotkeys.on('activated', (a: HotkeyAction) => void runHotkey(a).catch(notifyError))
    await asusd.start()
    createTray()
    const action = cliAction(process.argv)
    const hidden = process.argv.includes('--hidden') || settings.startHidden || (!!action && action !== 'toggle-window')
    createWindow(!hidden || !tray)
    if (action && action !== 'toggle-window') void runHotkey(action).catch(notifyError)
    if (settings.hotkeys) startHotkeys()
    // Per-key colours are not kept by the keyboard across reboots.
    const kbd = asusd.snapshot.aura[0]
    if (settings.customLightingActive && kbd) {
      void setCustomLighting(kbd.path, settings.customLighting).catch(() => {})
    }
  })
  app.on('before-quit', () => {
    quitting = true
    void hotkeys.stop()
    asusd.stop()
  })
  app.on('window-all-closed', () => {
    if (!tray) app.quit()
  })
}
