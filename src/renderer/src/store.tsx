import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AppSettings, AsusAction, AsusSnapshot, DisplayState, Sensors } from '@shared/asus'
import { resolveLocale, translator, type Translator } from '@shared/i18n'
import type { Toast } from '@shared/api'

interface Store {
  snap: AsusSnapshot | null
  sensors: Sensors | null
  display: DisplayState | null
  refreshDisplay(): Promise<void>
  /** Run an asusd action; errors surface as a toast and resolve to undefined. */
  act<T = void>(a: AsusAction, okText?: string): Promise<T | undefined>
  /** Keys of actions currently in flight, for per-control busy state. */
  busy: Set<string>
  toasts: (Toast & { id: number })[]
  toast(t: Toast): void
  settings: AppSettings | null
  updateSettings(patch: Partial<AppSettings>): Promise<void>
  t: Translator
}

const Ctx = createContext<Store | null>(null)

export function actionKey(a: AsusAction): string {
  switch (a.type) {
    case 'setPlatform':
      return `platform:${a.prop}`
    case 'setArmoury':
    case 'restoreArmoury':
      return `armoury:${a.id}`
    default:
      return a.type
  }
}

export function StoreProvider({ children }: { children: ReactNode }): ReactNode {
  const [snap, setSnap] = useState<AsusSnapshot | null>(null)
  const [sensors, setSensors] = useState<Sensors | null>(null)
  const [display, setDisplay] = useState<DisplayState | null>(null)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [toasts, setToasts] = useState<(Toast & { id: number })[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const nextId = useRef(1)

  const locale = resolveLocale(settings?.language, navigator.language)
  const t = useMemo(() => translator(locale), [locale])
  // Lets Chromium pick the right CJK glyph variants (Han unification) and fonts.
  useEffect(() => {
    document.documentElement.lang = locale
    document.title = t('app.name')
  }, [locale, t])

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    setSettings(await window.asus.setSettings(patch))
  }, [])

  const toast = useCallback((t: Toast) => {
    const id = nextId.current++
    setToasts((ts) => [...ts, { ...t, id }])
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), t.kind === 'error' ? 7000 : 3500)
  }, [])

  const refreshDisplay = useCallback(async () => {
    setDisplay(await window.asus.displayState())
  }, [])

  useEffect(() => {
    void window.asus.snapshot().then(setSnap)
    void window.asus.getSettings().then(setSettings)
    void refreshDisplay()
    const offs = [window.asus.onState(setSnap), window.asus.onSensors(setSensors), window.asus.onToast(toast)]
    return () => offs.forEach((off) => off())
  }, [refreshDisplay, toast])

  const act = useCallback(
    async <T,>(a: AsusAction, okText?: string): Promise<T | undefined> => {
      const key = actionKey(a)
      setBusy((b) => new Set(b).add(key))
      try {
        const r = await window.asus.action<T>(a)
        if (okText) toast({ kind: 'info', text: okText })
        return r
      } catch (e) {
        // Electron prefixes IPC errors with "Error invoking remote method ...".
        const msg = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)
        toast({ kind: 'error', text: t('error.failed', { message: msg }) })
        return undefined
      } finally {
        setBusy((b) => {
          const n = new Set(b)
          n.delete(key)
          return n
        })
      }
    },
    [toast, t]
  )

  return (
    <Ctx.Provider
      value={{ snap, sensors, display, refreshDisplay, act, busy, toasts, toast, settings, updateSettings, t }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useStore(): Store {
  const s = useContext(Ctx)
  if (!s) throw new Error('useStore outside StoreProvider')
  return s
}

export function useArmoury(id: string) {
  const { snap } = useStore()
  return snap?.armoury.find((a) => a.id === id)
}

export function useT(): Translator {
  return useStore().t
}

/**
 * Translate a message whose placeholders are React nodes, e.g. a {code} or
 * {link} inside a sentence, so translators can reorder them freely.
 */
export function rich(t: Translator, key: Parameters<Translator>[0], nodes: Record<string, ReactNode>): ReactNode {
  return t(key)
    .split(/(\{\w+\})/)
    .map((part, i) => {
      const m = /^\{(\w+)\}$/.exec(part)
      return m && m[1] in nodes ? <Fragment key={i}>{nodes[m[1]]}</Fragment> : part
    })
}
