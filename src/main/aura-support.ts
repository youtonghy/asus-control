// Works out whether an Aura keyboard takes per-key or per-zone colours, which
// asusd does not report over D-Bus. Uses the same data asusd and
// rog-control-center use: aura_support.ron (matched on the DMI board name)
// and the rog-gui keyboard layouts.

import { readFile } from 'node:fs/promises'
import type { AuraAdvanced, AuraDevice } from '@shared/asus'
import { matchSupport, parseLayout, parseSupportFile, type SupportEntry } from '@shared/aura-advanced'

const SUPPORT_FILES = ['/etc/asusd/asusd_user_ledmodes.ron', '/usr/share/asusd/aura_support.ron']
const LAYOUT_DIR = '/usr/share/rog-gui/layouts'

const readText = (p: string): Promise<string | null> => readFile(p, 'utf8').catch(() => null)

let entries: Promise<SupportEntry[]> | null = null
let board: Promise<string> | null = null

export async function auraAdvanced(devices: AuraDevice[]): Promise<AuraAdvanced[]> {
  entries ??= Promise.all(SUPPORT_FILES.map(readText)).then((files) =>
    files.flatMap((f) => (f ? parseSupportFile(f) : []))
  )
  // BOARD_NAME overrides the DMI name, as it does for asusd (handy for testing layouts).
  board ??= process.env.BOARD_NAME
    ? Promise.resolve(process.env.BOARD_NAME)
    : readText('/sys/class/dmi/id/board_name').then((s) => s?.trim() ?? '')
  const [all, boardName] = await Promise.all([entries, board])
  const out: AuraAdvanced[] = []
  for (const dev of devices) {
    // Object paths are <idProduct>_<devnum>_<devpath>.
    const match = matchSupport(all, boardName, dev.id.split('_')[0])
    if (!match || match.advanced.kind === 'none') continue
    const ron = match.advanced.kind === 'per-key' ? await readText(`${LAYOUT_DIR}/${match.layoutName}_US.ron`) : null
    out.push({
      path: dev.path,
      kind: match.advanced.kind,
      zones: match.advanced.kind === 'zoned' ? match.advanced.zones : [],
      layoutName: match.layoutName,
      layout: ron ? parseLayout(ron, match.layoutName) : null
    })
  }
  return out
}
