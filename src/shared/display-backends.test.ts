import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  gnomeApplyArgs,
  hyprlandGamut,
  hyprlandMonitorArg,
  kscreenGamutArgs,
  parseKscreenColor,
  parseGnome,
  parseHyprland,
  parseKscreen,
  parseSway,
  ratesAtCurrentSize,
  type GnomeState
} from './display-backends.ts'

test('kscreen: picks eDP and dedupes rates at the current size', () => {
  const json = JSON.stringify({
    outputs: [
      { name: 'HDMI-A-1', enabled: true, currentModeId: '9', modes: [] },
      {
        name: 'eDP-1',
        enabled: true,
        currentModeId: 2,
        modes: [
          { id: 1, size: { width: 2560, height: 1600 }, refreshRate: 60.0 },
          { id: 2, size: { width: 2560, height: 1600 }, refreshRate: 165.0 },
          { id: 3, size: { width: 2560, height: 1600 }, refreshRate: 59.94 },
          { id: 4, size: { width: 1920, height: 1200 }, refreshRate: 60.0 }
        ]
      }
    ]
  })
  const p = parseKscreen(json)!
  assert.equal(p.output, 'eDP-1')
  assert.deepEqual(
    ratesAtCurrentSize(p).map((m) => m.id),
    ['1', '2']
  )
})

const HYPR = JSON.stringify([
  {
    name: 'eDP-1',
    width: 2560,
    height: 1600,
    refreshRate: 165.0,
    x: 0,
    y: 0,
    scale: 1.6,
    transform: 0,
    disabled: false,
    availableModes: ['2560x1600@165.00Hz', '2560x1600@60.00Hz', '1920x1200@60.00Hz']
  }
])

test('hyprland: modes and monitor keyword', () => {
  const p = parseHyprland(HYPR)!
  assert.equal(p.currentModeId, '2560x1600@165.00')
  assert.deepEqual(
    ratesAtCurrentSize(p).map((m) => m.refresh),
    [60, 165]
  )
  assert.equal(hyprlandMonitorArg(HYPR, { modeId: '2560x1600@60.00' }), 'eDP-1,2560x1600@60.00,0x0,1.6')
  assert.equal(hyprlandGamut(HYPR), null)
})

test('hyprland: colour preset is kept and switched', () => {
  const json = JSON.stringify([{ ...JSON.parse(HYPR)[0], colorManagementPreset: 'edid' }])
  assert.deepEqual(hyprlandGamut(json), { mode: 'srgb', icc: null, modes: ['native', 'srgb'] })
  assert.equal(hyprlandMonitorArg(json, { modeId: '2560x1600@60.00' }), 'eDP-1,2560x1600@60.00,0x0,1.6,cm,edid')
  assert.equal(hyprlandMonitorArg(json, { cm: 'srgb' }), 'eDP-1,2560x1600@165.00,0x0,1.6,cm,srgb')
})

const KSCREEN_O = `\x1b[01;32mOutput: \x1b[0;0m1 eDP-2 828f9850-b085
\t\x1b[01;33mHDR: \x1b[0;0mincapable
\t\x1b[01;33mICC profile: \x1b[0;0mnone
\t\x1b[01;33mColor profile source: \x1b[0;0mEDID
Output: 2 HDMI-A-1 1234
\tICC profile: /home/me/ASUS P3.icm
\tColor profile source: ICC
`

test('kscreen: colour profile source and args', () => {
  assert.deepEqual(parseKscreenColor(KSCREEN_O, 'eDP-2'), { mode: 'srgb', icc: null, modes: ['native', 'srgb', 'icc'] })
  assert.deepEqual(parseKscreenColor(KSCREEN_O, 'HDMI-A-1')?.icc, '/home/me/ASUS P3.icm')
  assert.equal(parseKscreenColor(KSCREEN_O, 'DP-1'), null)
  assert.deepEqual(kscreenGamutArgs('eDP-2', 'native'), ['output.eDP-2.colorProfileSource.sRGB'])
  assert.deepEqual(kscreenGamutArgs('eDP-2', 'icc', '/a/b.icc'), [
    'output.eDP-2.iccprofile./a/b.icc',
    'output.eDP-2.colorProfileSource.ICC'
  ])
  assert.throws(() => kscreenGamutArgs('eDP-2', 'icc'))
})

test('sway: refresh is in mHz', () => {
  const json = JSON.stringify([
    {
      name: 'eDP-1',
      active: true,
      current_mode: { width: 2560, height: 1600, refresh: 165000 },
      modes: [
        { width: 2560, height: 1600, refresh: 60000 },
        { width: 2560, height: 1600, refresh: 165000 }
      ]
    }
  ])
  const p = parseSway(json)!
  assert.equal(p.currentModeId, '2560x1600@165.000Hz')
  assert.deepEqual(
    ratesAtCurrentSize(p).map((m) => m.id),
    ['2560x1600@60.000Hz', '2560x1600@165.000Hz']
  )
})

const v = (value: unknown): { value: unknown } => ({ value })
const GNOME: GnomeState = [
  7,
  [
    [
      ['eDP-1', 'BOE', '0x0a1b', '0'],
      [
        ['2560x1600@165.000', 2560, 1600, 165, 1.6, [1, 1.25, 1.6, 2], { 'is-current': v(true) }],
        ['2560x1600@60.000', 2560, 1600, 60, 1.6, [1, 1.25, 1.6, 2], {}]
      ],
      { 'is-builtin': v(true) }
    ],
    [
      ['DP-2', 'DEL', 'U2720Q', 'X'],
      [['3840x2160@60.000', 3840, 2160, 60, 2, [1, 2], { 'is-current': v(true) }]],
      {}
    ]
  ],
  [
    [0, 0, 1.6, 0, true, [['eDP-1', 'BOE', '0x0a1b', '0']], {}],
    [1600, 0, 2, 0, false, [['DP-2', 'DEL', 'U2720Q', 'X']], {}]
  ],
  { 'layout-mode': v(1) }
]

test('gnome: builtin panel and apply args keep the layout', () => {
  const p = parseGnome(GNOME)!
  assert.equal(p.output, 'eDP-1')
  assert.equal(p.currentModeId, '2560x1600@165.000')
  const a = gnomeApplyArgs(GNOME, '2560x1600@60.000')
  assert.equal(a.serial, 7)
  assert.equal(a.layoutMode, 1)
  assert.deepEqual(a.logical, [
    [0, 0, 1.6, 0, true, [['eDP-1', '2560x1600@60.000', {}]]],
    [1600, 0, 2, 0, false, [['DP-2', '3840x2160@60.000', {}]]]
  ])
  assert.throws(() => gnomeApplyArgs(GNOME, 'nope'))
})
