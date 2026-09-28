# AGENTS.md

Guidance for AI coding agents working in this repository.

## Product scope (core purpose)

The PC connects to attached devices (iPhone, iPad, etc.) over **wired USB and Wi-Fi** and operates on **the connected device's files only**: browse the device, pull files device → PC, push files PC → device.

The PC's own files are never the app's domain — no browsing, serving, or managing of PC-side folders; the configured destination folder is only a landing zone for incoming files. This is the root requirement; weigh feature decisions against it.

## Layering policy

- The React frontend (`src/`) is the **presentation layer**: rendering, UI state, and user interaction only. It must not own data-source concerns.
- The Rust backend (`src-tauri/src/`) owns the **domain and datasource layers**: external data sources (usbmuxd, filesystem, HTTP), polling/watching, change detection, retries, and business rules.
- When a feature needs to observe an external data source, implement the polling loop in the backend and push changes to the frontend via Tauri events; the frontend only listens and reacts.
- Do not add frontend timers/polling loops (`setInterval` etc.) for data the backend can own.

Precedent: `usb::watch_devices` (`src-tauri/src/usb.rs`) polls usbmuxd every 3 s and emits the `usb-devices` event only when the device set changes; `useUsbBrowser` (`src/hooks/useUsbBrowser.ts`) subscribes via `api.onUsbDevices` and reacts to pushed sets without polling.
