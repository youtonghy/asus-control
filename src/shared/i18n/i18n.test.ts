import { test } from 'node:test'
import assert from 'node:assert/strict'
import en from './en.ts'
import zhCN from './zh-CN.ts'
import ja from './ja.ts'
import ko from './ko.ts'
import { attrLabel, profileName, resolveLocale, translator } from './index.ts'

const LOCALES = { 'zh-CN': zhCN, ja, ko } as Record<string, Record<string, string>>
const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

test('every locale has exactly the English keys', () => {
  const keys = Object.keys(en).sort()
  for (const [id, dict] of Object.entries(LOCALES)) assert.deepEqual(Object.keys(dict).sort(), keys, id)
})

test('translations keep the same placeholders and are not empty', () => {
  for (const [id, dict] of Object.entries(LOCALES)) {
    for (const [key, source] of Object.entries(en)) {
      assert.ok(dict[key].trim(), `${id} ${key} is empty`)
      assert.deepEqual(placeholders(dict[key]), placeholders(source), `${id} ${key}`)
    }
  }
})

test('system locale tags resolve to shipped locales', () => {
  assert.equal(resolveLocale('system', 'zh-CN'), 'zh-CN')
  assert.equal(resolveLocale('system', 'zh_TW'), 'zh-CN')
  assert.equal(resolveLocale('system', 'ja-JP'), 'ja')
  assert.equal(resolveLocale(undefined, 'ko'), 'ko')
  assert.equal(resolveLocale('system', 'de-DE'), 'en')
  assert.equal(resolveLocale('ja', 'zh-CN'), 'ja')
  assert.equal(resolveLocale('system', ''), 'en')
})

test('translator interpolates and falls back', () => {
  const t = translator('zh-CN')
  assert.equal(t('fans.applyN', { n: 2 }), '应用（2）')
  assert.equal(profileName(t, 2), '静音')
  assert.equal(profileName(translator('ko'), 9), '프로필 9')
  assert.equal(attrLabel(t, 'unknown_attr'), 'unknown attr')
  assert.equal(attrLabel(t, 'unknown_attr', 'Kernel name'), 'Kernel name')
  assert.equal(t.dyn('batt.state.Weird', 'Weird'), 'Weird')
})
