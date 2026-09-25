import type {
  AppSettings,
  AsusAction,
  AsusSnapshot,
  AuraAdvanced,
  DisplayState,
  HistorySample,
  HotkeyAction,
  HotkeyState,
  Sensors
} from './asus'

export interface Toast {
  kind: 'error' | 'info'
  text: string
}

/** The bridge exposed by the preload script as `window.asus`. */
export interface AsusApi {
  snapshot(): Promise<AsusSnapshot>
  refresh(): Promise<AsusSnapshot>
  action<T = void>(a: AsusAction): Promise<T>
  displayState(): Promise<DisplayState>
  /** Native file picker for an ICC profile; null when cancelled. */
  pickIcc(): Promise<string | null>
  history(): Promise<HistorySample[]>
  auraAdvanced(): Promise<AuraAdvanced[]>
  hotkeys(): Promise<HotkeyState>
  configureHotkeys(): Promise<void>
  runHotkey(a: HotkeyAction): Promise<void>
  getSettings(): Promise<AppSettings>
  setSettings(s: Partial<AppSettings>): Promise<AppSettings>
  info(): Promise<{ version: string; electron: string; desktop: string }>
  openExternal(url: string): Promise<void>
  onState(cb: (s: AsusSnapshot) => void): () => void
  onSensors(cb: (s: Sensors) => void): () => void
  onToast(cb: (t: Toast) => void): () => void
  onDisplay(cb: (s: DisplayState) => void): () => void
  onSettings(cb: (s: AppSettings) => void): () => void
  onHotkeys(cb: (s: HotkeyState) => void): () => void
}
