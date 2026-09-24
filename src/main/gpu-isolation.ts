// Keep Chromium from waking a runtime-suspended NVIDIA dGPU.
//
// On hybrid laptops Chromium's GPU process renders on the iGPU, but at startup
// the EGL (glvnd) and Vulkan loaders open every vendor driver, and loading the
// NVIDIA one powers the dGPU up for a while. A power tool that costs battery
// just by opening would be silly, so we point both loaders at the non-NVIDIA
// drivers. Chromium does not pass env vars set at runtime on to its GPU
// process, so when they are missing we re-exec ourselves once with them set,
// before the app is ready and before any GPU process exists.
//
// Skipped when the dGPU drives the panel (MUX in Ultimate mode), when there is
// no NVIDIA GPU, or when ASUS_CONTROL_ALLOW_DGPU=1 is set.

import { spawn } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

function read(path: string): string | null {
  try {
    return readFileSync(path, 'utf8').trim()
  } catch {
    return null
  }
}

function pciVendors(): Set<string> {
  const root = '/sys/bus/pci/devices'
  const vendors = new Set<string>()
  try {
    for (const dev of readdirSync(root)) {
      // Display controllers only (class 0x03xxxx).
      if (read(join(root, dev, 'class'))?.startsWith('0x03')) {
        const v = read(join(root, dev, 'vendor'))
        if (v) vendors.add(v)
      }
    }
  } catch {
    /* not Linux sysfs */
  }
  return vendors
}

function firstExisting(dirs: string[], match: (name: string) => boolean): string[] {
  for (const dir of dirs) {
    try {
      const files = readdirSync(dir).filter(match).map((f) => join(dir, f))
      if (files.length) return files
    } catch {
      /* missing dir */
    }
  }
  return []
}

/** Env overrides that hide NVIDIA from the GL/Vulkan loaders, or null if not wanted. */
export function dgpuIsolationEnv(): Record<string, string> | null {
  if (process.platform !== 'linux' || process.env.ASUS_CONTROL_ALLOW_DGPU === '1') return null

  const vendors = pciVendors()
  const hasNvidia = vendors.has('0x10de')
  const hasIgpu = vendors.has('0x1002') || vendors.has('0x8086')
  if (!hasNvidia || !hasIgpu) return null

  // gpu_mux_mode 0 = Ultimate: the panel hangs off the dGPU, so leave it alone.
  if (read('/sys/class/firmware-attributes/asus-armoury/attributes/gpu_mux_mode/current_value') === '0') return null

  const egl = firstExisting(['/usr/share/glvnd/egl_vendor.d', '/etc/glvnd/egl_vendor.d'], (f) => /mesa/i.test(f))
  if (!egl.length) return null
  const vk = firstExisting(['/usr/share/vulkan/icd.d', '/etc/vulkan/icd.d'], (f) => f.endsWith('.json') && !/nvidia/i.test(f))

  const env: Record<string, string> = {
    __EGL_VENDOR_LIBRARY_FILENAMES: egl.join(':'),
    __GLX_VENDOR_LIBRARY_NAME: 'mesa'
  }
  if (vk.length) env.VK_DRIVER_FILES = env.VK_ICD_FILENAMES = vk.join(':')
  return env
}

/**
 * Re-exec with the isolation env when it is missing. Returns true if this
 * process is being replaced and should exit without starting the app.
 */
export function relaunchIsolatedIfNeeded(): boolean {
  if (process.env.ASUS_CONTROL_RELAUNCHED === '1') return false
  // Under `electron-vite dev` a detached re-exec would escape the dev server's
  // process control (reload / Ctrl+C), so dev runs are left un-isolated.
  if (process.env.ELECTRON_RENDERER_URL) return false
  const env = dgpuIsolationEnv()
  if (!env) return false
  // Respect anything the user already set explicitly.
  const missing = Object.fromEntries(Object.entries(env).filter(([k]) => process.env[k] === undefined))
  if (!Object.keys(missing).length) return false

  Object.assign(process.env, missing, { ASUS_CONTROL_RELAUNCHED: '1' })
  try {
    if (process.env.APPIMAGE) relaunchAppImage(process.env.APPIMAGE)
    // Chromium's relauncher passes process.env through and closes stray fds.
    else app.relaunch()
    return true
  } catch {
    return false // run un-isolated rather than not at all
  }
}

/**
 * app.relaunch() cannot be used inside an AppImage: its helper runs from the
 * mount, which disappears as soon as we exit. Spawn the image instead. Node
 * leaves non-CLOEXEC fds open in the child, and both Chromium (icudtl.dat, the
 * V8 snapshot, app.asar in the mount) and the AppImage runtime (its keepalive
 * pipe) leave some; inherited, they keep the old mount and its FUSE process
 * alive for the whole session. The child needs none of them, so every fd
 * above stderr is remapped onto stderr, which amounts to closing it.
 */
function relaunchAppImage(image: string): void {
  const stdio: (number | 'inherit')[] = ['inherit', 'inherit', 'inherit']
  const fds = readdirSync('/proc/self/fd').map(Number).filter((fd) => fd > 2)
  const max = Math.max(2, ...fds)
  // Positions not listed would be inherited as-is, so fill the whole range.
  for (let fd = 3; fd <= max; fd++) stdio.push(2)
  spawn(image, process.argv.slice(1), { env: process.env, detached: true, stdio }).unref()
}
