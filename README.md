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
| **Screen** | Switch the panel refresh rate (KDE Plasma, GNOME, Hyprland and Sway), panel overdrive and **colour gamut** (Native / sRGB / ICC profile on KDE Plasma, Native / sRGB on Hyprland). G-Helper-style **auto** modes drop to the lowest rate and turn overdrive off on battery, and restore them on AC. |
| **Fans** | Drag-to-edit 8-point fan curves for each fan and each mode, with the live temperature marked and the saved curve shown as a ghost. Arrow keys work too. |
| **Power limits** | SPL / sPPT / fPPT and NVIDIA sliders, per mode (asusd tuning group). |
| **Lighting** | Aura effects with animated previews, colours, speed and direction, brightness, and LED power states (boot / awake / sleep / shutdown). **Per-key** and **per-zone** colours on keyboards that support them, painted on the model's real layout and sent with `DirectAddressingRaw`. |
| **AniMe Matrix / Slash** | Display on/off, brightness, built-in animations per power state and auto-off rules for AniMe Matrix; mode, brightness, interval and when-to-show options for the Slash lightbar. The page only appears when asusd reports the device. |
| **Battery** | Charge limit (with 60/80/100 presets), one-time full charge, health and cycles, switching modes automatically on AC or battery. |
| **System** | CPU EPP per mode, firmware attributes (boot sound, MCU power save, …), tray, start hidden, start on login. |
| **Live bar** | CPU and GPU temperatures, fan RPM, battery power draw, and the dGPU sleep state. |
| **Monitor** | Charts of temperatures, fan speed, battery power and CPU clock over the last 5 / 15 / 30 minutes, with hover and keyboard read-out. |
| **Hotkeys** | Global shortcuts through the XDG GlobalShortcuts portal: show/hide the window (ROG key by default), next performance mode, keyboard brightness, lighting effect, refresh rate, AniMe/Slash on/off. The same actions work as `asus-control --action=<id>` for desktops without the portal. |

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
- Optional, for refresh-rate switching: KDE Plasma (`kscreen-doctor`), GNOME
  (Mutter), Hyprland (`hyprctl`) or Sway (`swaymsg`)
- Optional, for hotkeys: `xdg-desktop-portal` with a GlobalShortcuts backend
  (KDE Plasma, GNOME 48+, Hyprland). The portal needs the app's `.desktop`
  file. The packages install one, and AppImage integrations are detected.
- Optional, for per-key lighting: the keyboard layouts in
  `/usr/share/rog-gui/layouts` (shipped with asusctl / rog-control-center)

## Development

```bash
npm install
npm run dev        # hot-reloading dev app (dGPU isolation is skipped in dev)
npm test           # unit tests: asusd mappings + translation completeness
npm run typecheck
npm run dist       # AppImage + pacman + deb in dist/
```

The pacman and deb targets use electron-builder's bundled `fpm`, whose Ruby
links against `libcrypt.so.1`. On Arch-based systems, install
`libxcrypt-compat` first. Without it the build fails with exit code 127.

## Architecture

```
src/
  shared/asus.ts        asusd enums, value mappings, curve logic (pure, unit-tested)
  shared/aura-advanced.ts  per-key / zone HID packets, aura_support.ron + layout parsing
  shared/display-backends.ts  kscreen / Mutter / Hyprland / Sway parsing
  shared/api.ts         the typed window.asus bridge
  shared/i18n/          en (source) + zh-CN / ja / ko dictionaries, translator, locale resolution
  main/asusd.ts         D-Bus client (dbus-next): snapshot + PropertiesChanged → live updates
  main/sensors.ts       hwmon / power_supply / PCI runtime-PM polling (only while the window is shown)
  main/display.ts       refresh-rate backends (kscreen-doctor, Mutter D-Bus, hyprctl, swaymsg)
  main/hotkeys.ts       XDG GlobalShortcuts portal client
  main/aura-support.ts  per-key / zone detection (same data as asusd)
  main/gpu-isolation.ts keeps Chromium off the dGPU
  main/index.ts         window, tray, IPC, settings, autostart
  preload/index.ts      contextBridge (sandboxed renderer, context isolation)
  renderer/src/         React UI (pages/, components/ for the fan curve editor,
                        history charts and keyboard painter)
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
- AniMe (`xyz.ljones.Anime`) and Slash (`xyz.ljones.Slash`) objects live under
  `/xyz/ljones/aura/` next to the keyboards, so children are told apart by
  their interfaces.
- asusd does not report whether a keyboard is per-key or zoned. The app reads
  `/usr/share/asusd/aura_support.ron` and matches the DMI board name the way
  asusd does. `BOARD_NAME=...` overrides the board name, as it does for asusd.
  Per-key packets follow rog-aura's 11-packet layout, so the lid and per-key
  lightbar LEDs (a 12th packet) are not addressable yet.

## Roadmap ideas (from G-Helper)

- Custom AniMe images and GIFs through the asusd-user session daemon
  (`InsertImage` / `InsertAsusGif` on the session bus)
- Per-key effects (animated), and the lid / per-key lightbar LEDs
- Refresh-rate switching on X11 (`xrandr`) and other wlroots compositors

## License

MPL-2.0 (same as asusctl).
