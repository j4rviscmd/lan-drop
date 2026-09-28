# AGENTS.md

Guidance for AI coding agents working in this repository.

## Layering policy

- The React frontend (`src/`) is the **presentation layer**: rendering, UI state, and user interaction only. It must not own data-source concerns.
- The Rust backend (`src-tauri/src/`) owns the **domain and datasource layers**: external data sources (usbmuxd, filesystem, HTTP), polling/watching, change detection, retries, and business rules.
- When a feature needs to observe an external data source, implement the polling loop in the backend and push changes to the frontend via Tauri events; the frontend only listens and reacts.
- Do not add frontend timers/polling loops (`setInterval` etc.) for data the backend can own.

Precedent: `usb::watch_devices` (`src-tauri/src/usb.rs`) polls usbmuxd every 3 s and emits the `usb-devices` event only when the device set changes; `useUsbBrowser` (`src/hooks/useUsbBrowser.ts`) subscribes via `api.onUsbDevices` and reacts to pushed sets without polling.
