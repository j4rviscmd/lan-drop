# lan-drop DESIGN

Windows ⇄ iPhone file transfer app built with Tauri 2.0.

## Status

Feasibility study completed (2026-09-27). Agreed architecture: **Model S** (browser-based, no iPhone app).

## Goal

Transfer files between a Windows PC and an iPhone over Wi-Fi/LAN, driven by a Tauri 2.0 desktop app running on the Windows side.

## Scope

- Personal use (single user, own devices)
- Wi-Fi/LAN only. USB is out of scope for the initial version
- Plain HTTP is acceptable; PIN authentication is optional

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
│ Tauri 2.0 app       │  http://192.168.x.x:PORT   │ Any browser     │
│ ├ WebView (UI)      │◄──────────────────────────►│ (opened via QR) │
│ ├ axum HTTP server  │  Web UI + multipart upload │                 │
│ │  (list/up/down)   │  downloads / Web Share     │                 │
│ └ QR/URL/PIN display│                            │                 │
└─────────────────────┘
```

- The Tauri app embeds an HTTP server (axum + tokio, spawned in the setup hook) that:
  - serves a small web UI (upload form, PC-side file list, download buttons)
  - receives multipart uploads (streamed straight to disk)
  - serves file downloads for the iPhone side
- The iPhone side is a thin client. Any iOS browser works: Safari, Chrome, Edge, Firefox — all iOS browsers are WebKit-based (except EU-region alternatives), so behavior is identical. Camera QR scan opens the default browser; Chrome can scan QR from its address bar or the URL can be typed manually.
- "Add to Home Screen" in Safari gives an icon-launched standalone (PWA-like) experience without re-scanning the QR code.

## HTTP API (common contract, shared with future Model N)

The API is designed to be reused when an iPhone-native app (Model N) is added later:

- `GET /` — web UI
- `GET /api/health` — server info (alias, version, PIN required?)
- `GET /api/list?path=...` — list served folder contents
- `GET /api/download?path=...` — download a file
- `POST /api/upload` — multipart streaming upload
- `GET /api/events` (WebSocket or SSE) — transfer progress events

## Tech Stack

| Element | Choice |
|---|---|
| Desktop shell | Tauri 2.0 (Windows) |
| HTTP server | axum + tokio, in-process |
| Upload receiving | axum multipart, streamed to disk |
| Progress push | WebSocket or SSE → frontend |
| QR code | `qrcode` crate (SVG) |
| LAN IP detection | `local-ip-address` crate |
| Future auto-discovery | `mdns-sd` (pure Rust, no Bonjour SDK needed on Windows) |

## Known Risks / Limitations

- Large uploads from the browser are interrupted by screen lock or tab backgrounding. The Screen Wake Lock API requires a secure context (HTTPS); with plain HTTP the UI must instruct the user to keep the screen on during transfer.
- Some web APIs (Clipboard, etc.) require secure contexts — avoid depending on them under plain HTTP.
- Guest Wi-Fi with AP isolation blocks peer-to-peer LAN traffic (common to all Wi-Fi designs).
- Windows Firewall prompts on first run; the NSIS installer can add a rule (requires elevation).
- Self-signed HTTPS would trigger browser warnings; agreed to stay on plain HTTP for personal use.

## Future: Model N (iPhone-native app)

The owner has a Mac + Xcode, so a Tauri 2.0 iOS app is feasible later. Model N inverts the operation model: the Windows app browses the iPhone (user-granted folders + photo library via PhotoKit) exposed by the iPhone app over the same HTTP API. Costs: Mac + Xcode required for builds, Apple Developer Program ($99/yr) for distribution (free provisioning expires every 7 days). The shared HTTP API above keeps this migration open.

## References

- LocalSend protocol v2.2 (reference implementation of the same architecture): https://github.com/localsend/protocol
- Tauri prerequisites (iOS/macOS build requirements): https://v2.tauri.app/start/prerequisites/
- iOS local network privacy (native apps only; browser access unaffected): https://developer.apple.com/documentation/bundleresources/information-property-list/nslocalnetworkusagedescription
- mdns-sd crate: https://docs.rs/mdns-sd
