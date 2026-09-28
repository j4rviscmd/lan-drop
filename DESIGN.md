# lan-drop DESIGN

Windows ⇄ iPhone file transfer app built with Tauri 2.0.

## Status

- 2026-09-27: MVP implemented on the `mvp` worktree (uncommitted). **PC side complete and verified**: Tauri app, axum HTTPS server (rustls, local CA, 90-day leaf), QR display, streamed multipart upload (temp-file + rename), Downloads served-folder list/download, SSE progress, desktop loopback listener, plain-HTTP CA setup listener (`:8790`). cargo build/clippy/fmt/tests green; live smoke: 3 MiB upload/download SHA256-identical.
- **iPhone access blocked by iOS browser policy** (details in Known Risks). The CA-trust setup path (`http://IP:8790` → install profile → enable trust) is implemented but was not completed on the device; with the CA fully trusted the HTTPS path is expected to open warning-free (unverified on device).
- 2026-09-27 (final): owner chose **Option C (Filey-style USB)** for the primary path, wired-first. Implemented in the same worktree: `idevice` crate (usbmuxd over TCP :27015 on Windows, lockdown pairing, AFC). Desktop UI gained an "iPhone via USB cable" card: device list, one-tap Pair (Trust dialog on the phone), AFC browser (DCIM etc.), file pull to Downloads\lan-drop, file push to the phone's media partition `/lan-drop`, progress reusing the Transfers panel. Prerequisite on the PC: Apple Mobile Device Service via the Microsoft Store "Apple Devices" app (or iTunes) — it was not installed on the dev PC yet. Wi-Fi (Wi-Fi Sync) comes later per the original plan.
- 2026-09-28 (`usb-grid-view`): USB explorer UX overhaul, device-verified. Grid/list toggle (SVG type icons, no emoji); JPEG EXIF thumbnails via new `usb_thumbnail` command (128 KiB head read, hand-rolled IFD1 parser + base64, lazy IntersectionObserver); initial view = user-installed apps (`usb_apps` via installation_proxy Lookup User) with per-app browsing over house_arrest **VendDocuments** — VendContainer is refused with `InstallationLookupFailed` since iOS 8.3, and the vend session still roots at the app container with only `/Documents` readable (UI prefixes paths accordingly; non-file-sharing apps gray out after one failed attempt; the media partition moved behind a "Media partition" tile). Two-column window (default 1080×720): cards left, explorer owns the right, page never scrolls (left column and file list scroll internally). QR/URL card removed from the UI — the Wi-Fi server stays alive only for the desktop loopback progress EventSource.
- 2026-09-28 (`react-migration`): frontend migrated from vanilla JS to **React 19 + TypeScript + Vite 6 + Tailwind v4 + ObsidianUI** (shadcn-style registry, neutral dark theme). Rust backend unchanged; `tauri.conf.json` build block now drives Vite (devUrl :5173, frontendDist ../dist), `withGlobalTauri` dropped in favor of `@tauri-apps/api`. All vanilla-JS behavior ported 1:1 (status strings, house_arrest error paths, view persistence, lazy EXIF thumbs via a cached in-view hook). UX additions: sonner toasts + transfer direction icons, empty/skeleton states, drag-and-drop push (webview drag-drop events → absolute paths → `usb_push`), explorer search filter, USB/Wi-Fi badge (`connection` from usbmuxd — Wi-Fi Sync devices appear as Network), and the previously dead `serve_root` row now populated. Review caught a critical missing `index.css` import (production build shipped zero CSS) — fixed.
- 2026-09-28 (`startup-path`): explorer settings dialog (gear beside the view toggle, ObsidianUI): "Use current folder" registers the browsed (scope, cwd) as the launch default — persisted to localStorage `usb-start-path`, shape-validated on read; unset keeps the app grid. Launch navigation runs after pairing via a fallback chain (missing folder → its scope root → app grid) so a stale entry never dead-ends.
- 2026-09-28 (`remove-serve-root`): PC→phone Wi-Fi serving removed — `/api/list`, `/api/download`, the "PC files" browser on the phone page, and the `serve_root` concept. The LAN HTTPS server is now upload-only (phone→PC into `Downloads\lan-drop`); PC→device transfer is USB push. Rationale: the owner's flow is device-side file operations, and the unauthenticated listener no longer exposes the whole Downloads folder to the LAN. `tokio-util` dependency dropped.
- 2026-09-28 (`custom-upload-dir`): upload destination is user-configurable — folder-picker button on the Storage card, default still `Downloads\lan-drop`. New `settings.rs` persists the choice to `config.json` in the app data dir (missing/corrupt file → defaults, never blocks startup; configured-but-unusable path at launch, e.g. unplugged drive, falls back to the default while keeping the saved choice). `AppState.upload_dir` became a `parking_lot::RwLock` so the running server switches folders without restart via the `set_upload_dir` command (create+canonicalize → persist → swap; a failed save leaves state unchanged). USB pulls follow the same folder: the frontend re-fetches `server_info` after a change, which feeds both the Storage card display and the pull destination.
- 2026-09-28 (`remove-lan-path`): browser LAN path removed entirely — HTTPS LAN listener, local CA (`tls.rs`), the `:8790` CA-setup listener, `POST /api/upload`, the phone web UI (`src-tauri/src/web/`), and QR generation. Rationale: product scope pinned in AGENTS.md — the PC drives and operates on the connected device's files only; Wi-Fi transfer returns later via usbmuxd Wi-Fi Sync over the existing USB stack. Kept: the loopback SSE listener (`:8788+`, USB pull/push progress) and `upload_dir` settings. NSIS no longer registers a firewall rule (loopback-only now; the uninstall hook stays to clean the legacy rule). Deps dropped: rcgen, qrcode, axum-server, rustls, local-ip-address, time (the `tower` dev-dep stays — tests use `ServiceExt::oneshot` against the router).
- 2026-09-28 (`entry-context-menu`): right-click context menu on explorer entry cards (Radix ContextMenu via ObsidianUI) — files: Save to PC / Copy file name / Delete from device; folders: Open / Download folder / Copy folder name / Delete folder. `usb_pull` now recurses directories host-side (`pull_dir` walk, per-file progress reusing the SSE events, `unique_path` per child so sanitized-name collisions dedupe instead of overwriting), and a new `usb_delete` command maps dirs to AFC `remove_all` / files to `remove`. Folders gained bulk-pull checkboxes (sibling of the open button — no nested interactives), so "Pull to PC" covers mixed file/folder selections; delete runs behind a native `confirm` (plugin-dialog) and reloads the listing.
- 2026-09-28 (`push-refresh`): grid refresh after USB push — `pushPath` now re-lists the current directory on success (previously the pushed file only appeared after reconnect). A `locRef` mirrors the latest browsed (scope, cwd) so a push finishing after mid-transfer navigation refreshes only when the drop-time folder is still on screen; the view is never yanked back.
- 2026-09-28 (`selection-basket`): ticks became a cross-folder basket — selection moved from a per-directory name set (cleared on every navigation) to `ReadonlyMap<key, SelectedEntry>` with each item carrying its own (scope, cwd), so ticks survive navigation and one bulk pull/delete spans folders (key = JSON `[scopeId, cwd, name]`; folder identity is compared component-wise — string-prefix matching on JSONized keys breaks on closing brackets and would cross-match subfolders). `Shell` now owns `useUsbBrowser` and renders a left-rail "Selected" card (rows with app/folder location, × untick, three-dot menu: Delete N from device… / Clear list) so the bulk targets are visible; the explorer keeps a per-folder "x/y selected here" counter and a "Pull N to PC" button; select-all adds/removes only the visible folder's ticks; switching or losing the device clears the basket.
- 2026-09-28 (`app-icon`): app icon set replaced (was the Tauri default) — hand-drawn SVG source (`src-tauri/icons/app-icon.svg`: dark-neutral rounded square matching the ObsidianUI zinc palette, two opposing transfer arrows, pull solid / push 42% white), rasterized to a transparent 1024px PNG (`app-icon.png`, kept as the `tauri icon` source) and regenerated in place via `tauri icon` (ico/icns/PNG + StoreLogo/Square* set; the auto-generated iOS/Android folders were deleted — Windows-desktop app, `bundle.icon` paths unchanged). 16px legibility verified by pixel sampling (arrow 252 vs bg 35).
- 2026-09-29 (`stretch-cards`): left-rail cards stretch at >=860px — Storage keeps its natural height (`shrink-0`) while the Selected and Transfers cards split the remaining column space 1:1 (`flex-1` + `min-h-0` chained down to the lists, which scroll internally; the old `max-h-44`/`max-h-[200px]` caps and the Transfers `mt-auto` bottom-pin dropped). Below 860px the stacked mobile layout is unchanged.

## Design pivot options (open decision)

| # | Approach | How it dodges the iOS walls | Cost |
|---|---|---|---|
| A | Finish CA trust on the iPhone (keep Model S) | No dodge; one-time profile install + trust toggle | 5 minutes on the device; already implemented |
| B | Plain-HTTP mode (serve the app on :8790) | Requires "Warn When Connecting Over HTTP" (HTTPS-Only) to stay OFF | Trivial code; permanent global iOS setting |
| C | **Filey-style**: USB-first pairing + Apple Wi-Fi Sync (usbmuxd/lockdownd over TCP, AFC) | No browser, no TLS, no iOS UI — Apple's own channel | High: proprietary protocol stack on Windows (libimobiledevice-level), iTunes/AMDS driver dependency, per-service quirks |
| D | **Model N**: native iPhone app (Tauri iOS) speaking the existing HTTP API | Native app: NSLocalNetworkUsageDescription + certificate pinning; no Safari involvement | High: Mac + Xcode required; free provisioning expires weekly (paid $99/yr removes it); PC side already fits |

Recommendation for the next session: try A once (cheapest, everything is already built); if the owner wants zero browser/policy exposure, D is the architecturally clean pivot and reuses the PC-side server as-is; C avoids installing anything on the iPhone but is the deepest protocol work.

## Goal

Transfer files between a Windows PC and an iPhone over Wi-Fi/LAN, driven by a Tauri 2.0 desktop app running on the Windows side.

## Scope

- Personal use (single user, own devices)
- Wi-Fi/LAN only. USB is out of scope for the initial version
- HTTPS with an app-generated local CA (2026-09-27: plain HTTP is hard-blocked by iOS 26 Safari's HTTPS-Only toggle). PIN authentication is optional

## iOS Constraints (why not "Finder-like")

Non-jailbroken iOS exposes no way for any external tool — Wi-Fi, USB, or otherwise — to browse the whole device filesystem. This is Apple's sandbox design, not a limitation of this app.

What is reachable:

| Area | Access |
|---|---|
| App's own sandbox | unrestricted |
| User-granted folders (Files app) | document picker, one-time grant, persistent |
| Photo library | PhotoKit, permission-based |

Consequences:

- Windows→iPhone: over USB (AFC push to the phone's media partition). The Wi-Fi server is upload-only; it no longer serves PC files.
- iPhone→Windows: the user selects files in the browser's file picker (which can browse Files app, iCloud Drive, and Photos) and uploads them.

## Architecture (Model S)

```
┌─Windows─────────────┐         Wi-Fi/LAN          ┌─iPhone──────────┐
│ Tauri 2.0 app       │ https://192.168.x.x:PORT  │ Any browser     │
│ ├ WebView (UI)      │◄──────────────────────────│ (opened via QR) │
│ ├ axum HTTPS server │  web UI + multipart upload│                 │
│ │  (upload only)    │                            │                 │
│ └ QR/URL/PIN display│                            │                 │
└─────────────────────┘                            └─────────────────┘
```

- The Tauri app embeds an HTTPS server (axum + tokio, spawned in the setup hook) that:
  - serves a small web UI (upload form)
  - receives multipart uploads (streamed straight to disk)
  - serves `GET /ca.crt` for the one-time iPhone trust setup
- TLS: `rcgen` generates a local CA (persisted in the app data dir) and a per-launch leaf certificate whose SAN covers the current LAN IP. A plain-HTTP loopback listener serves only the desktop webview (its store does not trust our CA).
- The iPhone side is a thin client. Any iOS browser works: Safari, Chrome, Edge, Firefox — all iOS browsers are WebKit-based (except EU-region alternatives), so behavior is identical. Camera QR scan opens the default browser; Chrome can scan QR from its address bar or the URL can be typed manually.
- "Add to Home Screen" in Safari gives an icon-launched standalone (PWA-like) experience without re-scanning the QR code.

## HTTP API (common contract, shared with future Model N)

The API is designed to be reused when an iPhone-native app (Model N) is added later:

- `GET /` — web UI
- `GET /ca.crt` — local CA certificate (one-time iPhone trust setup)
- `GET /api/health` — server info (alias, version, PIN required?)
- `POST /api/upload` — multipart streaming upload
- `GET /api/events` (WebSocket or SSE) — transfer progress events

## Tech Stack

| Element | Choice |
|---|---|
| Desktop shell | Tauri 2.0 (Windows) |
| Frontend | React 19 + TypeScript + Vite 6 + Tailwind v4 + ObsidianUI components |
| HTTP server | axum + tokio, in-process; axum-server + rustls for TLS |
| Certificates | `rcgen`: persisted local CA, per-launch leaf (SAN = LAN IP) |
| Progress push | WebSocket or SSE → frontend |
| QR code | `qrcode` crate (SVG) |
| LAN IP detection | `local-ip-address` crate |
| Future auto-discovery | `mdns-sd` (pure Rust, no Bonjour SDK needed on Windows) |

## Known Risks / Limitations

- Large uploads are interrupted by screen lock or tab backgrounding. Mitigated since HTTPS: the web UI requests the Screen Wake Lock API while uploading (still a best-effort hint; iOS may refuse).
- iOS 26 Safari with "Warn When Connecting Over HTTP" (設定 › アプリ › Safari › プライバシーとセキュリティ › 接続が安全ではないときに警告) enabled hard-blocks plain-HTTP navigation ("navigation failed … HTTPS-Only") with no per-site bypass — the trigger for switching to HTTPS (2026-09-27).
- **Empirical iOS findings (2026-09-27, byte-level capture on device):** Apple's TLS policy rejects leaves whose validity exceeds the 825/398-day limit — rcgen's default 1975..4096 window made Safari send an encrypted `certificate_unknown` alert after key derivation (curl/schannel and node accept such certs, so local tests pass while iOS fails). Fixed by issuing 90-day leaves. Separately, the certificate-exception flow ("この接続は安全ではありません → 続ける") did **not** complete on the test device (iOS 18.7 / Safari 26.6.1): every retry re-aborted TLS and Safari fell back to plaintext HTTP on the same port (→ "応答を解析できません"). The reliable path is installing and fully trusting the CA (setup page on :8790). axum-server's 10 s TLS handshake timeout also kills connections while the user reads the warning — raised to 600 s.
- HTTPS uses our own local CA: until the user installs and trusts it (one-time, `http://IP:8790`), Safari shows a certificate warning that must be tapped through. The CA private key lives in the app data dir; anyone who steals it can MITM the LAN — acceptable for personal use.
- Guest Wi-Fi with AP isolation blocks peer-to-peer LAN traffic (common to all Wi-Fi designs).
- Windows Firewall: no longer applicable since `remove-lan-path` — the app binds 127.0.0.1 only, which the firewall never blocks. Installers before that release registered a program-scoped inbound allow rule; the current uninstall hook still removes it on uninstall.
- DHCP IP changes are handled per-launch (leaf re-issued), but a changed IP invalidates the QR the user scanned earlier.
- Reference point: CopyTrans Filey achieves PC→iPhone Wi-Fi transfer without any of these walls because it never uses a browser — one-time USB pairing, then Apple's own Wi-Fi Sync protocol (usbmuxd/lockdownd over TCP).

## Future: Model N (iPhone-native app)

The owner has a Mac + Xcode, so a Tauri 2.0 iOS app is feasible later. Model N inverts the operation model: the Windows app browses the iPhone (user-granted folders + photo library via PhotoKit) exposed by the iPhone app over the same HTTP API. Costs: Mac + Xcode required for builds, Apple Developer Program ($99/yr) for distribution (free provisioning expires every 7 days). The shared HTTP API above keeps this migration open.

## References

- LocalSend protocol v2.2 (reference implementation of the same architecture): https://github.com/localsend/protocol
- Tauri prerequisites (iOS/macOS build requirements): https://v2.tauri.app/start/prerequisites/
- iOS local network privacy (native apps only; browser access unaffected): https://developer.apple.com/documentation/bundleresources/information-property-list/nslocalnetworkusagedescription
- mdns-sd crate: https://docs.rs/mdns-sd
