import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isAddressable,
  keyCap,
  matchSupport,
  parseLayout,
  parseSupportFile,
  perKeyPackets,
  zonedPacket
} from './aura-advanced.ts'

test('per-key packets match rog-aura addressing', () => {
  const white: [number, number, number] = [255, 255, 255]
  const p = perKeyPackets({ D: white, O: white, M: [1, 2, 3] })
  assert.equal(p.length, 11)
  assert.ok(p.every((r) => r.length === 64))
  assert.deepEqual(p[0].slice(0, 8), [0x5d, 0xbc, 0x00, 0x01, 0x01, 0x01, 0x00, 0x10])
  assert.equal(p[3][6], 0x30)
  assert.equal(p[10][6], 0xa0)
  assert.equal(p[10][7], 0x08)
  assert.deepEqual(p[5].slice(30, 34), [255, 255, 255, 0]) // D
  assert.deepEqual(p[4].slice(33, 37), [255, 255, 255, 0]) // O
  assert.deepEqual(p[7].slice(12, 15), [1, 2, 3]) // M
})

test('multi-LED keys light all their LEDs', () => {
  const p = perKeyPackets({ Spacebar: [9, 9, 9] })
  for (const at of [15, 18, 21, 24, 27]) assert.deepEqual(p[8].slice(at, at + 3), [9, 9, 9])
  assert.ok(isAddressable('Spacebar'))
  assert.ok(!isAddressable('LidLogo'))
})

test('zoned packet', () => {
  const [pkt] = zonedPacket({ ZonedKbRight: [255, 0, 0], LightbarLeft: [0, 0, 255] }, true)
  assert.deepEqual(pkt.slice(0, 5), [0x5d, 0xbc, 0x01, 0x01, 0x04])
  assert.deepEqual(pkt.slice(18, 21), [255, 0, 0])
  assert.deepEqual(pkt.slice(42, 45), [0, 0, 255])
  assert.equal(zonedPacket({}, false)[0][4], 0)
})

const SUPPORT = `([
    (
        device_name: "G513I",
        product_id: "",
        layout_name: "g513i",
        basic_modes: [Static],
        basic_zones: [],
        advanced_type: Zoned([ZonedKbLeft, ZonedKbRight, LightbarLeft]),
        power_zones: [Keyboard],
    ),
    (
        device_name: "G513",
        product_id: "",
        layout_name: "g513i-per-key",
        basic_modes: [Static],
        basic_zones: [],
        advanced_type: PerKey,
        power_zones: [Keyboard],
    ),
    (
        device_name: "GA402X",
        product_id: "19b6",
        layout_name: "ga401q",
        basic_modes: [Static],
        basic_zones: [],
        advanced_type: r#None,
        power_zones: [Keyboard],
    ),
])`

test('support file parsing and matching follows asusd', () => {
  const entries = parseSupportFile(SUPPORT)
  assert.equal(entries.length, 3)
  assert.deepEqual(entries[0].advanced, { kind: 'zoned', zones: ['ZonedKbLeft', 'ZonedKbRight', 'LightbarLeft'] })
  assert.equal(matchSupport(entries, 'G513IH', '')?.layoutName, 'g513i') // longest name wins
  assert.equal(matchSupport(entries, 'G513QR', '')?.advanced.kind, 'per-key')
  assert.equal(matchSupport(entries, 'GA402XV', '19b6')?.advanced.kind, 'none')
  assert.equal(matchSupport(entries, 'GA402XV', '1866'), null)
  assert.equal(matchSupport(entries, 'FX505', ''), null)
})

const LAYOUT = `(
    locale: "US",
    key_shapes: {
        "regular": Led(width: 1.0, height: 1.0, pad_left: 0.1, pad_right: 0.1, pad_top: 0.1, pad_bottom: 0.1),
        "wide": Led(width: 2.0, height: 1.0, pad_left: 0.1, pad_right: 0.1, pad_top: 0.1, pad_bottom: 0.1),
        "gap": Blank(width: 0.5, height: 0.0),
    },
    key_rows: [
        (
            pad_left: 0.1,
            pad_top: 0.1,
            row: [
                (Esc, "regular"),
                (Spacing, "gap"),
                (F1, "regular"), // comment
            ],
        ),
        (
            pad_left: 0.1,
            pad_top: 0.1,
            row: [
                (Tab, "wide"),
                (Q, "regular"),
            ],
        ),
    ],
)`

test('layout parsing positions keys like rog-control-center', () => {
  const l = parseLayout(LAYOUT, 'test')
  assert.deepEqual(
    l.keys.map((k) => k.code),
    ['Esc', 'F1', 'Tab', 'Q']
  )
  const [esc, f1, tab, q] = l.keys
  assert.deepEqual([esc.x, esc.y], [0, 0])
  assert.equal(f1.x, 1.7) // 1.0 + 0.1 pad + 0.5 gap + 0.1 pad
  assert.equal(tab.y, 1.3) // row height 1.2 + next row pad 0.1
  assert.equal(q.x, 2.2)
  assert.equal(l.width, 3.2)
  assert.equal(l.height, 2.3)
})

test('key caps', () => {
  assert.equal(keyCap('N7'), '7')
  assert.equal(keyCap('LBracket'), '[')
  assert.equal(keyCap('Q'), 'Q')
  assert.equal(keyCap('Spacebar5_2'), '')
})
