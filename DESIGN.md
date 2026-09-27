# lan-drop DESIGN

Windows ⇄ iPhone file transfer app built with Tauri 2.0.

## Status

- 2026-09-27: MVP implemented on the `mvp` worktree (uncommitted). **PC side complete and verified**: Tauri app, axum HTTPS server (rustls, local CA, 90-day leaf), QR display, streamed multipart upload (temp-file + rename), Downloads served-folder list/download, SSE progress, desktop loopback listener, plain-HTTP CA setup listener (`:8790`). cargo build/clippy/fmt/tests green; live smoke: 3 MiB upload/download SHA256-identical.
- **iPhone access blocked by iOS browser policy** (details in Known Risks). The CA-trust setup path (`http://IP:8790` → install profile → enable trust) is implemented but was not completed on the device; with the CA fully trusted the HTTPS path is expected to open warning-free (unverified on device).
- 2026-09-27 (final): owner chose **Option C (Filey-style USB)** for the primary path, wired-first. Implemented in the same worktree: `idevice` crate (usbmuxd over TCP :27015 on Windows, lockdown pairing, AFC). Desktop UI gained an "iPhone via USB cable" card: device list, one-tap Pair (Trust dialog on the phone), AFC browser (DCIM etc.), file pull to Downloads\lan-drop, file push to the phone's media partition `/lan-drop`, progress reusing the Transfers panel. Prerequisite on the PC: Apple Mobile Device Service via the Microsoft Store "Apple Devices" app (or iTunes) — it was not installed on the dev PC yet. Wi-Fi (Wi-Fi Sync) comes later per the original plan.

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

- Windows→iPhone: files are delivered as browser downloads or via the Web Share API (photos/videos can be saved directly to the Photos app). They land in the browser's Downloads folder / Photos / user-chosen target, not arbitrary paths.
- iPhone→Windows: the user selects files in the browser's file picker (which can browse Files app, iCloud Drive, and Photos) and uploads them.

## Architecture (Model S)

```
┌─Windows─────────────┐         Wi-Fi/LAN          ┌─iPhone──────────┐
│ Tauri 2.0 app       │ https://192.168.x.x:PORT  │ Any browser     │
│ ├ WebView (UI)      │◄──────────────────────────►│ (opened via QR) │
│ ├ axum HTTPS server │  Web UI + multipart upload │                 │
│ │  (list/up/down)   │  downloads / Web Share     │                 │
│ └ QR/URL/PIN display│                            │                 │
└─────────────────────┘
```

- The Tauri app embeds an HTTPS server (axum + tokio, spawned in the setup hook) that:
  - serves a small web UI (upload form, PC-side file list, download buttons)
  - receives multipart uploads (streamed straight to disk)
  - serves file downloads for the iPhone side
  - serves `GET /ca.crt` for the one-time iPhone trust setup
- TLS: `rcgen` generates a local CA (persisted in the app data dir) and a per-launch leaf certificate whose SAN covers the current LAN IP. A plain-HTTP loopback listener serves only the desktop webview (its store does not trust our CA).
- The iPhone side is a thin client. Any iOS browser works: Safari, Chrome, Edge, Firefox — all iOS browsers are WebKit-based (except EU-region alternatives), so behavior is identical. Camera QR scan opens the default browser; Chrome can scan QR from its address bar or the URL can be typed manually.
- "Add to Home Screen" in Safari gives an icon-launched standalone (PWA-like) experience without re-scanning the QR code.

## HTTP API (common contract, shared with future Model N)

The API is designed to be reused when an iPhone-native app (Model N) is added later:

- `GET /` — web UI
- `GET /ca.crt` — local CA certificate (one-time iPhone trust setup)
- `GET /api/health` — server info (alias, version, PIN required?)
- `GET /api/list?path=...` — list served folder contents
- `GET /api/download?path=...` — download a file
- `POST /api/upload` — multipart streaming upload
- `GET /api/events` (WebSocket or SSE) — transfer progress events

## Tech Stack

| Element | Choice |
|---|---|
| Desktop shell | Tauri 2.0 (Windows) |
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
- Windows Firewall prompts on first run; the NSIS installer can add a rule (requires elevation).
- DHCP IP changes are handled per-launch (leaf re-issued), but a changed IP invalidates the QR the user scanned earlier.
- Reference point: CopyTrans Filey achieves PC→iPhone Wi-Fi transfer without any of these walls because it never uses a browser — one-time USB pairing, then Apple's own Wi-Fi Sync protocol (usbmuxd/lockdownd over TCP).

## Future: Model N (iPhone-native app)

The owner has a Mac + Xcode, so a Tauri 2.0 iOS app is feasible later. Model N inverts the operation model: the Windows app browses the iPhone (user-granted folders + photo library via PhotoKit) exposed by the iPhone app over the same HTTP API. Costs: Mac + Xcode required for builds, Apple Developer Program ($99/yr) for distribution (free provisioning expires every 7 days). The shared HTTP API above keeps this migration open.

## References

- LocalSend protocol v2.2 (reference implementation of the same architecture): https://github.com/localsend/protocol
- Tauri prerequisites (iOS/macOS build requirements): https://v2.tauri.app/start/prerequisites/
- iOS local network privacy (native apps only; browser access unaffected): https://developer.apple.com/documentation/bundleresources/information-property-list/nslocalnetworkusagedescription
- mdns-sd crate: https://docs.rs/mdns-sd
