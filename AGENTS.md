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

## Releases (release-please)

Automated by release-please (`release-please-config.json` + `.release-please-manifest.json`). The app version lives only in `src-tauri/tauri.conf.json`; `package.json` and `src-tauri/Cargo.toml` stay unmanaged so `Cargo.lock` never drifts against `--locked` CI. Version files, the manifest, tags, and GitHub Releases are all maintained by release-please — never bump versions or create tags/releases by hand (the manual `/release` skill is superseded in this repo).

- Merging `feat:`/`fix:`/`perf:`/`revert:` to `main` opens a `chore(main): release X.Y.Z` PR. Merging that PR creates the `vX.Y.Z` tag + GitHub Release, then dispatches `publish.yml` to build and attach the Windows NSIS installer.
- The installer is uploaded under two names: the versioned `lan-drop_X.Y.Z_x64-setup.exe` (archive) and a stable copy `lan-drop-setup.exe` — the latter backs the `releases/latest/download/lan-drop-setup.exe` link intended for the README Installation section.
- `publish.yml` also signs the installer (`TAURI_SIGNING_PRIVATE_KEY` repo secret; empty-password minisign key) and uploads `*.sig` + a `latest.json` updater manifest. The app checks `releases/latest/download/latest.json` on startup (`AppUpdateInitializer`) and force-updates when the manifest version is newer — public repo, so no auth is embedded.
- PRs are squash-merged with the PR title as the commit message, so the title must carry the type. Changes with no end-user impact (dev-only code, CI, tooling, docs) use a non-triggering type (`chore:`, `style:`, `test:`, `docs:`, `refactor:`, `ci:`) so they don't ship a release.
- The release PR is authored with `GITHUB_TOKEN`, so PR-triggered CI never runs on it. Once CI is enabled with required checks (at public launch), merge it with an admin override (owner permits `--admin`).
- `publish.yml` recovery: run it manually from the Actions tab with the `tag` input (or "Re-run failed jobs" — it is a single idempotent job); uploads use `--clobber` so re-runs replace assets safely.

## Dependency updates (Renovate)

Renovate (`renovate.json` + the Mend-hosted Renovate GitHub App) opens dependency-update PRs for the npm frontend, the Cargo backend, and GitHub Actions workflows. Patch and minor updates and lockfile maintenance automerge (squash) once CI passes; major updates are manual-review PRs. Note: Renovate classifies cargo 0.x minor bumps (e.g. 0.6 → 0.7) as `minor` — breaking by Rust convention, but still automerged; failing CI (clippy/test) is the guard that keeps them out. Renovate titles patch PRs `fix(deps):` and minor PRs `chore(deps):`, so an automerged patch update may open a release-please release PR — accepted trade-off. Renovate never bumps the app's own version (`src-tauri/tauri.conf.json`) and ignores the vendored path dependency (`src-tauri/vendor/tauri-plugin-mcp-bridge`).
