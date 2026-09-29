# lan-drop DESIGN

Windows ⇄ iPhone file transfer app built with Tauri 2.0. The PC pairs with an iPhone over USB (Apple's usbmuxd channel) and operates on the device's files: browse, pull, push. Wi-Fi (Wi-Fi Sync) comes later. Product scope: the connected device's files only — the PC's own folders are never the app's domain (see AGENTS.md).

## Architecture

- Layering: the React frontend (`src/`) is presentation only; the Rust backend (`src-tauri/src/`) owns data sources, polling, retries, and business rules, pushing changes via Tauri events. Precedent: `usb::watch_devices` polls usbmuxd every 3 s and emits `usb-devices` only when the set changes; `useUsbBrowser` subscribes and reacts without its own timers.
- Device channel (`usb.rs`, on the `idevice` crate): usbmuxd at `127.0.0.1:27015` (provided by Apple Mobile Device Service), lockdown pairing (Trust dialog on the phone), then two browse scopes:
  - Media partition (AFC) — camera roll etc.
  - User-installed apps via installation_proxy Lookup + house_arrest **VendDocuments**; only `/Documents` is readable (VendContainer has been refused since iOS 8.3). Apps without file sharing gray out after one failed attempt.
- Transfers: `usb_pull` (recursive directory walk, per-file progress, `unique_path` so sanitized-name collisions dedupe instead of overwriting), `usb_push` (drag-and-drop paths land in the browsed folder, recursively for folders; the grid re-lists on success), `usb_delete` (AFC `remove`/`remove_all` behind a native confirm). Progress events flow over SSE from a **loopback-only** axum listener (`:8788+` fallback).
- Thumbnails: `usb_thumbnail` reads a 128 KiB head and parses EXIF IFD1 (JPEG only) → base64; rendered lazily via IntersectionObserver.
- Settings (`settings.rs`): upload destination persisted to `config.json` in the app data dir (default `Downloads\lan-drop`). Missing/corrupt file → defaults, never blocks startup; a configured-but-unusable path falls back to the default while keeping the saved choice. `AppState.upload_dir` is a `parking_lot::RwLock`; `set_upload_dir` creates + canonicalizes + persists + swaps, leaving state unchanged on failure.
- Auto-update (`AppUpdateInitializer` + `useAppUpdate`): release builds check `releases/latest/download/latest.json` on startup (dev builds are gated off by `import.meta.env.PROD`) and force-apply newer versions via tauri-plugin-updater — download → install → relaunch — behind a blocking overlay with no skip. Any check/download failure fails open to normal startup, so a broken release feed cannot brick an installed app.

## UI

- Two-column window (default 1080×720): cards left, explorer owns the right, the page never scrolls. At ≥860px the Selected and Transfers cards split the leftover column space 1:1; below that the layout stacks.
- Explorer: initial view = installed apps; media partition behind a tile. Grid/list toggle, search filter, breadcrumbs, EXIF thumbnails, per-folder selection counter, right-click context menu (save / copy name / delete; folders add open + download).
- Selection basket: ticks survive navigation and span folders — `ReadonlyMap` keyed by `[scopeId, cwd, name]` with folder identity compared component-wise (string-prefix matching on JSONized keys cross-matches subfolders). The left-rail "Selected" card shows the targets; bulk pull/delete; losing the device clears it.
- Startup path: "Use current folder" in the explorer settings dialog persists the launch default (localStorage `usb-start-path`, shape-validated on read); navigation after pairing falls back missing folder → scope root → app grid.

## Tech stack

| Element | Choice |
|---|---|
| Desktop shell | Tauri 2.0 (Windows) |
| Frontend | React 19 + TypeScript + Vite 6 + Tailwind v4 + ObsidianUI |
| Device protocol | `idevice` crate: usbmuxd (TCP :27015) → lockdown → AFC / house_arrest |
| Progress push | SSE over a loopback-only axum listener |
| Auto-update | tauri-plugin-updater + tauri-plugin-process, minisign-signed NSIS artifacts |
| Settings | `config.json` in the app data dir |

## Known limitations

- PC prerequisite: Apple Mobile Device Service must be running (Store "Apple Devices" app or iTunes), or no device appears.
- house_arrest exposes only each app's `/Documents` (iOS ≥ 8.3). Whole-filesystem browsing is impossible on non-jailbroken iOS — Apple's sandbox design, not a limitation of this app.
- Thumbnails are JPEG-EXIF-only; other files show type icons.
- The NSIS uninstall hook still removes the legacy firewall rule registered by pre-`remove-lan-path` installers; the app itself is loopback-only.
- Wi-Fi Sync devices already surface in the device list (badge shows Network), but transfers are untested future work.
