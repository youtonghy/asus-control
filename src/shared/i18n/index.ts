// Tiny dependency-free i18n shared by the main process (tray, notifications)
// and the renderer. English is the source; other locales are type-checked to
// have exactly the same keys.

import en from './en.ts'
import zhCN from './zh-CN.ts'
import ja from './ja.ts'
import ko from './ko.ts'

export type MessageKey = keyof typeof en
export type Messages = Record<MessageKey, string>
export type Locale = 'en' | 'zh-CN' | 'ja' | 'ko'
/** 'system' follows the OS locale. */
export type LanguagePref = 'system' | Locale

export const LOCALES: { id: Locale; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'zh-CN', name: '简体中文' },
  { id: 'ja', name: '日本語' },
  { id: 'ko', name: '한국어' }
]

const MESSAGES: Record<Locale, Messages> = { en, 'zh-CN': zhCN, ja, ko }

/** Map a BCP 47 tag (from the OS or a setting) to a supported locale. */
export function resolveLocale(pref: string | undefined, systemTag: string): Locale {
  const tag = (pref && pref !== 'system' ? pref : systemTag || 'en').toLowerCase().replace('_', '-')
  // Only Simplified Chinese is shipped; it is a closer fallback for other
  // Chinese variants than English.
  if (tag.startsWith('zh')) return 'zh-CN'
  if (tag.startsWith('ja')) return 'ja'
  if (tag.startsWith('ko')) return 'ko'
  return 'en'
}

export type Vars = Record<string, string | number>

function interpolate(s: string, vars?: Vars): string {
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
}

export interface Translator {
  (key: MessageKey, vars?: Vars): string
  /** For keys built at runtime (e.g. `profile.${n}`); returns `fallback` when missing. */
  dyn(key: string, fallback: string, vars?: Vars): string
  locale: Locale
}

export function translator(locale: Locale): Translator {
  const dict = MESSAGES[locale]
  const t = ((key: MessageKey, vars?: Vars) => interpolate(dict[key] ?? en[key] ?? key, vars)) as Translator
  t.dyn = (key, fallback, vars) => {
    const s = (dict as Record<string, string>)[key] ?? (en as Record<string, string>)[key]
    return interpolate(s ?? fallback, vars)
  }
  t.locale = locale
  return t
}

// ---------------------------------------------------------------- domain helpers

export const profileName = (t: Translator, p: number): string =>
  t.dyn(`profile.${p}`, t('profile.unknown', { n: p }))

export const profileHint = (t: Translator, p: number): string => t.dyn(`profile.${p}.hint`, '')

export function attrLabel(t: Translator, id: string, displayName?: string): string {
  return t.dyn(`attr.${id}`, displayName ?? id.replace(/_/g, ' '))
}

/** Our own description if we have one, otherwise the kernel's display_name. */
export function attrDescription(t: Translator, id: string, displayName?: string): string | undefined {
  const d = t.dyn(`attr.${id}.desc`, '')
  return d || displayName
}

export const attrValue = (t: Translator, id: string, v: number): string => t.dyn(`attr.${id}.value.${v}`, String(v))
