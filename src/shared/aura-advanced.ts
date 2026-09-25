// Per-key and per-zone keyboard colours through asusd's Aura
// `DirectAddressingRaw(aay)`, which forwards raw 64-byte HID packets.
// Packet layout, LED addresses and the support/layout file formats mirror
// rog-aura (keyboard/advanced.rs, keyboard/layouts.rs, aura_detection.rs).
// Everything here is pure so it can be unit-tested.

import type { Rgb } from './asus.ts'

// ---------------------------------------------------------------- packets

const PACKET_LEN = 64
const PER_KEY_ROWS = 11

/** [packet row, byte offset of R] for per-key keyboards. */
const PER_KEY_ADDR: Record<string, [number, number]> = {
  VolDown: [0, 15], VolUp: [0, 18], MicMute: [0, 21], RogApp: [0, 24],
  Esc: [1, 24], F1: [1, 30], F2: [1, 33], F3: [1, 36], F4: [1, 39],
  F5: [1, 45], F6: [1, 48], F7: [1, 51], F8: [1, 54],
  F9: [2, 12], F10: [2, 15], F11: [2, 18], F12: [2, 21], Del: [2, 24],
  Tilde: [2, 39], N1: [2, 42], N2: [2, 45], N3: [2, 48], N4: [2, 51], N5: [2, 54],
  N6: [3, 9], N7: [3, 12], N8: [3, 15], N9: [3, 18], N0: [3, 21], Hyphen: [3, 24], Equals: [3, 27],
  Backspace3_1: [3, 30], Backspace3_2: [3, 33], Backspace3_3: [3, 36], Home: [3, 39], Tab: [3, 54],
  Q: [4, 9], W: [4, 12], E: [4, 15], R: [4, 18], T: [4, 21], Y: [4, 24], U: [4, 27], I: [4, 30],
  O: [4, 33], P: [4, 36], LBracket: [4, 39], RBracket: [4, 42], BackSlash: [4, 45], PgUp: [4, 54],
  Caps: [5, 21], A: [5, 24], S: [5, 27], D: [5, 30], F: [5, 33], G: [5, 36], H: [5, 39], J: [5, 42],
  K: [5, 45], L: [5, 48], SemiColon: [5, 51], Quote: [5, 54],
  Return: [6, 9], Return3_1: [6, 12], Return3_2: [6, 15], Return3_3: [6, 18], PgDn: [6, 21],
  LShift: [6, 36], LShift3_1: [6, 39], LShift3_2: [6, 36], LShift3_3: [6, 36],
  Z: [6, 42], X: [6, 45], C: [6, 48], V: [6, 51], B: [6, 54],
  N: [7, 9], M: [7, 12], Comma: [7, 15], Period: [7, 18], FwdSlash: [7, 21],
  Rshift: [7, 24], Rshift3_1: [7, 27], Rshift3_2: [7, 30], Rshift3_3: [7, 33], End: [7, 36],
  LCtrl: [7, 51], LFn: [7, 54],
  Meta: [8, 9], LAlt: [8, 12], Spacebar5_1: [8, 15], Spacebar5_2: [8, 18], Spacebar5_3: [8, 21],
  Spacebar5_4: [8, 24], Spacebar5_5: [8, 27], RAlt: [8, 30], PrtSc: [8, 33], RCtrl: [8, 36],
  Up: [8, 42], RFn: [8, 51],
  Left: [9, 54],
  Down: [10, 9], Right: [10, 12]
  // Lid and per-key lightbar LEDs sit in a 12th packet that rog-aura does not
  // build (its packet set has 11 rows), so they are left out here too.
}

/** Keys drawn as one cap in the layouts but lit by several LEDs. */
const ALIASES: Record<string, string[]> = {
  Backspace: ['Backspace3_1', 'Backspace3_2', 'Backspace3_3'],
  Spacebar: ['Spacebar5_1', 'Spacebar5_2', 'Spacebar5_3', 'Spacebar5_4', 'Spacebar5_5']
}

/** Byte offset of R for zoned keyboards (a single packet). */
const ZONE_ADDR: Record<string, number> = {
  SingleZone: 9,
  ZonedKbLeft: 9,
  ZonedKbLeftMid: 12,
  ZonedKbRightMid: 15,
  ZonedKbRight: 18,
  LightbarRight: 27,
  LightbarRightCorner: 30,
  LightbarRightBottom: 33,
  LightbarLeftBottom: 36,
  LightbarLeftCorner: 39,
  LightbarLeft: 42
}

/** Every LED a per-key packet set can address. */
export const PER_KEY_CODES = Object.keys(PER_KEY_ADDR)

/** Whether a layout key can be coloured on a per-key keyboard. */
export const isAddressable = (code: string): boolean => code in PER_KEY_ADDR || code in ALIASES

export function perKeyPackets(colours: Record<string, Rgb>): number[][] {
  const rows = Array.from({ length: PER_KEY_ROWS }, (_, i) => {
    const row = new Array<number>(PACKET_LEN).fill(0)
    row[0] = 0x5d // report id
    row[1] = 0xbc // custom (direct) mode
    row[3] = 0x01
    row[4] = 0x01
    row[5] = 0x01
    row[6] = i << 4 // key group
    row[7] = i === PER_KEY_ROWS - 1 ? 0x08 : 0x10
    return row
  })
  for (const [code, rgb] of Object.entries(colours)) {
    for (const led of ALIASES[code] ?? [code]) {
      const addr = PER_KEY_ADDR[led]
      if (addr) rows[addr[0]].splice(addr[1], 3, ...rgb)
    }
  }
  return rows
}

export function zonedPacket(colours: Record<string, Rgb>, multizoned: boolean): number[][] {
  const pkt = new Array<number>(PACKET_LEN).fill(0)
  pkt[0] = 0x5d
  pkt[1] = 0xbc
  pkt[2] = 0x01
  pkt[3] = 0x01
  pkt[4] = multizoned ? 0x04 : 0x00
  for (const [code, rgb] of Object.entries(colours)) {
    const at = ZONE_ADDR[code]
    if (at !== undefined) pkt.splice(at, 3, ...rgb)
  }
  return [pkt]
}

// ---------------------------------------------------------------- support data

export type AdvancedType = { kind: 'none' } | { kind: 'per-key' } | { kind: 'zoned'; zones: string[] }

export interface SupportEntry {
  deviceName: string
  productId: string
  layoutName: string
  advanced: AdvancedType
}

/** Parse asusd's `aura_support.ron` (a list of `LedSupportData`). */
export function parseSupportFile(ron: string): SupportEntry[] {
  const out: SupportEntry[] = []
  const re =
    /device_name:\s*"([^"]*)"\s*,\s*product_id:\s*"([^"]*)"\s*,\s*layout_name:\s*"([^"]*)"[\s\S]*?advanced_type:\s*(r#None|None|PerKey|Zoned\(\[([^\]]*)\]\))/g
  for (const m of stripComments(ron).matchAll(re)) {
    let advanced: AdvancedType = { kind: 'none' }
    if (m[4] === 'PerKey') advanced = { kind: 'per-key' }
    else if (m[4].startsWith('Zoned')) {
      const zones = m[5].split(',').map((s) => s.trim()).filter(Boolean)
      advanced = { kind: 'zoned', zones }
    }
    out.push({ deviceName: m[1], productId: m[2], layoutName: m[3], advanced })
  }
  return out
}

/**
 * Same rule as asusd's `LedSupportFile::match_device`: entries sorted by name,
 * searched in reverse so whole names win over prefixes, matched with
 * `board_name.contains(device_name)` and then the USB product id if given.
 */
export function matchSupport(entries: SupportEntry[], boardName: string, productId: string): SupportEntry | null {
  const sorted = [...entries].sort((a, b) => (a.deviceName < b.deviceName ? -1 : a.deviceName > b.deviceName ? 1 : 0))
  for (const e of sorted.reverse()) {
    if (!boardName.includes(e.deviceName)) continue
    if (e.productId && e.productId !== productId) continue
    return e
  }
  return null
}

// ---------------------------------------------------------------- layouts

export interface LayoutKey {
  code: string
  x: number
  y: number
  w: number
  h: number
}

export interface KeyLayout {
  name: string
  width: number
  height: number
  keys: LayoutKey[]
}

type Shape = { led: boolean; width: number; height: number; padL: number; padR: number; padT: number; padB: number }

function stripComments(s: string): string {
  return s.replace(/\/\/[^\n]*/g, '')
}

function numFields(s: string): Record<string, number> {
  const f: Record<string, number> = {}
  for (const m of s.matchAll(/(\w+)\s*:\s*(-?\d+(?:\.\d+)?)/g)) f[m[1]] = Number(m[2])
  return f
}

/** Parse a rog-control-center keyboard layout (`/usr/share/rog-gui/layouts/*.ron`) into positioned keys. */
export function parseLayout(ron: string, name = ''): KeyLayout {
  const src = stripComments(ron)
  const shapes = new Map<string, Shape>()
  for (const m of src.matchAll(/"([^"]+)"\s*:\s*(Led|Blank)\s*\(([^)]*)\)/g)) {
    const f = numFields(m[3])
    shapes.set(m[1], {
      led: m[2] === 'Led',
      width: f.width ?? 1,
      height: f.height ?? 1,
      padL: f.pad_left ?? 0,
      padR: f.pad_right ?? 0,
      padT: f.pad_top ?? 0,
      padB: f.pad_bottom ?? 0
    })
  }

  const rowsAt = src.indexOf('key_rows')
  const keys: LayoutKey[] = []
  let y = 0
  if (rowsAt >= 0) {
    const rowRe = /\(\s*((?:\w+\s*:\s*-?\d+(?:\.\d+)?\s*,\s*)*)row\s*:\s*\[([^\]]*)\]/g
    for (const m of src.slice(rowsAt).matchAll(rowRe)) {
      const pads = numFields(m[1])
      y += pads.pad_top ?? 0
      let x = pads.pad_left ?? 0
      let rowH = 0
      for (const k of m[2].matchAll(/\(\s*(\w+)\s*,\s*"([^"]+)"\s*\)/g)) {
        const s = shapes.get(k[2])
        if (!s) continue
        if (!s.led) {
          x += s.width
          rowH = Math.max(rowH, s.height)
          continue
        }
        x += s.padL
        if (k[1] !== 'Spacing' && k[1] !== 'Blocking') keys.push({ code: k[1], x, y: y + s.padT, w: s.width, h: s.height })
        x += s.width + s.padR
        rowH = Math.max(rowH, s.height + s.padT + s.padB)
      }
      y += rowH
    }
  }

  if (!keys.length) return { name, width: 0, height: 0, keys }
  const minX = Math.min(...keys.map((k) => k.x))
  const minY = Math.min(...keys.map((k) => k.y))
  const moved = keys.map((k) => ({ ...k, x: round(k.x - minX), y: round(k.y - minY) }))
  return {
    name,
    width: round(Math.max(...moved.map((k) => k.x + k.w))),
    height: round(Math.max(...moved.map((k) => k.y + k.h))),
    keys: moved
  }
}

const round = (v: number): number => Math.round(v * 1000) / 1000

/** Short keycap text for a layout code (not translated: these are printed on the keys). */
export function keyCap(code: string): string {
  const fixed: Record<string, string> = {
    VolDown: 'Vol−', VolUp: 'Vol+', MicMute: 'Mic', RogApp: 'ROG', RogFan: 'Fan', Esc: 'Esc', Del: 'Del',
    Tilde: '`', Hyphen: '-', Equals: '=', Backspace: '⌫', Home: 'Home', Tab: 'Tab', LBracket: '[',
    RBracket: ']', BackSlash: '\\', PgUp: 'PgUp', PgDn: 'PgDn', Caps: 'Caps', SemiColon: ';', Quote: "'",
    Return: 'Enter', LShift: 'Shift', Rshift: 'Shift', Comma: ',', Period: '.', FwdSlash: '/', End: 'End',
    LCtrl: 'Ctrl', RCtrl: 'Ctrl', LFn: 'Fn', RFn: 'Fn', Meta: '⊞', LAlt: 'Alt', RAlt: 'Alt', Spacebar: '',
    PrtSc: 'PrtSc', Pause: 'Pause', Up: '↑', Down: '↓', Left: '←', Right: '→', MediaPlay: '⏯',
    MediaStop: '⏹', MediaNext: '⏭', MediaPrev: '⏮', NumLock: 'Num', Star: '*', NumPadPlus: '+',
    NumPadEnter: 'Ent', NumPadDel: 'Del', NumPadPause: 'Pause', NumPadPrtSc: 'PrtSc', NumPadHome: 'Home'
  }
  if (code in fixed) return fixed[code]
  if (/^N\d$/.test(code)) return code.slice(1)
  if (/^(Backspace|Return|LShift|Rshift|Spacebar)\d_\d$/.test(code)) return ''
  if (/^Lightbar|^Lid/.test(code)) return ''
  return code
}
