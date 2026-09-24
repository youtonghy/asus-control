import { relaunchIsolatedIfNeeded } from './gpu-isolation'
import { join } from 'node:path'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { BrowserWindow, Menu, Notification, Tray, app, ipcMain, nativeImage, shell } from 'electron'
import {
  availableGpuModes,
  gpuModeFrom,
  sortProfiles,
  type AppSettings,
  type AsusAction,
  type AsusSnapshot,
  type Sensors
} from '@shared/asus'
import { profileName, resolveLocale, translator, type Translator } from '@shared/i18n'
// Bundled by electron-vite, so the path is valid in dev, unpacked and packaged builds.
import { trayTooltip } from '@shared/tray-tooltip'
import iconPath from '../../resources/icon.png?asset'
import { AsusdClient } from './asusd'
import { SensorPoller } from './sensors'
import { DisplayControl } from './display'

const asusd = new AsusdClient()
const sensors = new SensorPoller()
const display = new DisplayControl()

let win: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let sensorTimer: NodeJS.Timeout | null = null
let lastProfile: number | null = null

const DEFAULT_SETTINGS: AppSettings = { language: 'system', closeToTray: true, startHidden: false, autostart: false }
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
  return settings
}

async function applyAutostart(enabled: boolean): Promise<void> {
  if (!enabled) {
    await rm(autostartPath, { force: true })
    return
  }
  const exec = process.env.APPIMAGE ?? process.execPath
  const args = app.isPackaged ? '' : ` ${JSON.stringify(app.getAppPath())}`
  await mkdir(join(homedir(), '.config', 'autostart'), { recursive: true })
  await writeFile(
    autostartPath,
    [
      '[Desktop Entry]',
      'Type=Application',
      'Name=ASUS Control',
      'Comment=Control panel for ASUS laptops',
      `Exec="${exec}"${args} --hidden`,
      'Icon=asus-control',
      'X-GNOME-Autostart-enabled=true',
      ''
    ].join('\n')
  )
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

async function sensorTick(): Promise<void> {
  try {
    lastSensors = await sensors.read()
    if (win?.isVisible()) win.webContents.send('sensors', lastSensors)
    updateTrayTooltip()
  } catch {
    /* transient sysfs errors */
  }
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
      return asusd.setAuraEffect(a.path, a.effect)
    case 'setAuraPower':
      return asusd.setAuraPower(a.path, a.power)
    case 'oneShotFullCharge':
      return asusd.oneShotFullCharge()
    case 'setDisplayMode':
      return display.setMode(a.modeId)
    default:
      throw new Error(`Unknown action ${(a as { type: string }).type}`)
  }
}

function registerIpc(): void {
  ipcMain.handle('asus:snapshot', () => asusd.snapshot)
  ipcMain.handle('asus:refresh', () => asusd.refresh())
  ipcMain.handle('asus:action', (_e, a: AsusAction) => runAction(a))
  ipcMain.handle('display:state', () => display.state())
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
  app.on('second-instance', showWindow)
  app.whenReady().then(async () => {
    await loadSettings()
    registerIpc()
    asusd.on('change', onSnapshot)
    await asusd.start()
    createTray()
    const hidden = process.argv.includes('--hidden') || settings.startHidden
    createWindow(!hidden || !tray)
  })
  app.on('before-quit', () => {
    quitting = true
    asusd.stop()
  })
  app.on('window-all-closed', () => {
    if (!tray) app.quit()
  })
}
