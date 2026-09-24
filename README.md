# ASUS Control

A G-Helper–style control panel for ASUS laptops on Linux, built with Electron.

It is a front end for **asusd**, the daemon from
[asusctl](https://github.com/OpenGamingCollective/asusctl). All hardware
access goes over D-Bus through asusd, so the app needs no root. The layout and
feature set follow [G-Helper](https://github.com/seerge/g-helper).

## Features

| Area | What you can do |
| --- | --- |
| **Performance mode** | Silent / Balanced / Turbo, colour-coded like G-Helper. Follows Fn+F5 live and shows a notification when the mode changes. |
| **GPU mode** | Eco / Standard / Ultimate, which sets `dgpu_disable` and `gpu_mux_mode` together. Shows the queued mode, which applies on reboot. |
| **Screen** | Switch the panel refresh rate (KDE Plasma via `kscreen-doctor`) and panel overdrive. |
| **Fans** | Drag-to-edit 8-point fan curves for each fan and each mode, with the live temperature marked and the saved curve shown as a ghost. Arrow keys work too. |
| **Power limits** | SPL / sPPT / fPPT and NVIDIA sliders, per mode (asusd tuning group). |
| **Lighting** | Aura effects with animated previews, colours, speed and direction, brightness, and LED power states (boot / awake / sleep / shutdown). |
| **Battery** | Charge limit (with 60/80/100 presets), one-time full charge, health and cycles, switching modes automatically on AC or battery. |
| **System** | CPU EPP per mode, firmware attributes (boot sound, MCU power save, …), tray, start hidden, start on login. |
| **Live bar** | CPU and GPU temperatures, fan RPM, battery power draw, and the dGPU sleep state. |

The UI adapts to what asusd reports. Cards for features your model lacks are
hidden. It uses the system's light or dark theme.

### Languages

English, 简体中文, 日本語 and 한국어. By default the app follows the system
locale, and you can change it under **System → App → Language**. The tray
menu and notifications follow the same setting. Wording reuses the terms from
G-Helper's translations where they exist (静音/平衡/增强, サイレント/ターボ,
…), so it will feel familiar to G-Helper users.

To add a language:

1. Copy `src/shared/i18n/zh-CN.ts`.
2. Translate the values.
3. Register it in `LOCALES`, `MESSAGES` and `resolveLocale` in
   `src/shared/i18n/index.ts`, and add it to `AppSettings.language`.

The `Messages` type rejects missing or extra keys at compile time. `npm test`
checks that every translation keeps the same `{placeholders}` as the English
source.

Error text that comes from asusd itself (D-Bus messages) is shown as-is inside
a translated sentence.

### It won't wake your dGPU

On hybrid laptops, simply launching a Chromium-based app normally powers up
the NVIDIA GPU, because the EGL and Vulkan loaders probe every driver. ASUS
Control relaunches itself once at startup with those loaders limited to the
iGPU driver (Mesa). This is skipped in Ultimate mode. It also never runs
`nvidia-smi` unless the dGPU is already awake. See
[`src/main/gpu-isolation.ts`](src/main/gpu-isolation.ts). To turn this off,
set `ASUS_CONTROL_ALLOW_DGPU=1`.

## Requirements

- An ASUS laptop supported by asusctl, with **asusd ≥ 6.x running**:
  `sudo systemctl enable --now asusd`
- Your user in one of the groups that asusd's D-Bus policy allows (`users`,
  `wheel`, `adm` or `sudo`)
- Optional: KDE Plasma (`kscreen-doctor`) for refresh-rate switching

## Development

```bash
npm install
npm run dev        # hot-reloading dev app (dGPU isolation is skipped in dev)
npm test           # unit tests: asusd mappings + translation completeness
npm run typecheck
npm run dist       # AppImage + pacman + deb in dist/
```

## Architecture

```
src/
  shared/asus.ts        asusd enums, value mappings, curve logic (pure, unit-tested)
  shared/api.ts         the typed window.asus bridge
  shared/i18n/          en (source) + zh-CN / ja / ko dictionaries, translator, locale resolution
  main/asusd.ts         D-Bus client (dbus-next): snapshot + PropertiesChanged → live updates
  main/sensors.ts       hwmon / power_supply / PCI runtime-PM polling (only while the window is shown)
  main/display.ts       kscreen-doctor refresh-rate backend
  main/gpu-isolation.ts keeps Chromium off the dGPU
  main/index.ts         window, tray, IPC, settings, autostart
  preload/index.ts      contextBridge (sandboxed renderer, context isolation)
  renderer/src/         React UI (pages/, components/FanCurveEditor.tsx)
```

### asusd API notes

- Service `xyz.ljones.Asusd` on the **system** bus. The interfaces are
  `xyz.ljones.Platform` and `xyz.ljones.FanCurves` on `/xyz/ljones`,
  `xyz.ljones.AsusArmoury` on `/xyz/ljones/asus_armoury/<attr>`, and
  `xyz.ljones.Aura` on `/xyz/ljones/aura/<dev>`.
- The Aura mode enum is exposed two ways. **Properties** (`LedModeData`,
  `SupportedBasicModes`) use the Rust discriminant, where Pulse = 10. **Method
  replies** (`AllModeData`) use the serde variant index, where Pulse = 9. See
  `AURA_MODES` in `shared/asus.ts`.
- GPU attributes (`dgpu_disable`, `gpu_mux_mode`) are **queued** by asusd and
  applied at shutdown. `QueuedGpuValue` shows what is pending.
- PPT attributes are refused unless `EnablePptGroup` is on for the current
  mode and power source. That in turn requires custom fan curves to be enabled
  for the mode.
- asusd rejects fan curves whose temperature or PWM points ever decrease. The
  editor pushes neighbouring points along to keep the curve valid.

## Roadmap ideas (from G-Helper)

- AniMe Matrix and Slash lightbar pages (asusd already exposes both)
- Refresh-rate backends for GNOME (Mutter D-Bus) and Hyprland/Sway
- Automatic 60 Hz on battery, and auto overdrive
- Temperature and power charts (history)
- Custom hotkeys (M4 / ROG key) through the asusd-user session daemon
- Per-key RGB via `DirectAddressingRaw`

## License

MPL-2.0 (same as asusctl).
