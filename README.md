# lan-drop

Windows ⇄ iPhone file transfer app built with Tauri 2.0. See [DESIGN.md](./DESIGN.md) for the architecture.

## Development

### Frontend stack

React 19 + TypeScript + Vite 6 + Tailwind CSS v4, with [ObsidianUI](https://www.obsidianui.dev/) components (shadcn-style copy-paste registry, MIT).

```bash
npm install
npm run tauri dev
```

`npm run build` type-checks and bundles the frontend into `dist/` (wired to Tauri via `src-tauri/tauri.conf.json`).

### Lint and formatting

- `npm run lint` — [Biome](https://biomejs.dev/) lint over the frontend (strict: warnings fail).
- `npm run format` — Biome format; `cargo fmt` (in `src-tauri/`) covers the Rust side.
- A pre-commit hook (`.githooks/pre-commit`, enabled automatically via the `prepare` script) runs both formatters and stages the result before every commit.

### CI

CI (`.github/workflows/ci.yml`) runs lint, frontend build, `cargo clippy -D warnings`, and `cargo test` on `windows-latest`.

## Releases

[release-please](https://github.com/googleapis/release-please) automates versioning: merging `feat:`/`fix:` PRs into `main` opens a `chore(main): release X.Y.Z` PR that bumps `src-tauri/tauri.conf.json` (the app's version source of truth — `package.json` and `src-tauri/Cargo.toml` stay unmanaged to keep `Cargo.lock` consistent with `--locked` CI) and updates `CHANGELOG.md`. Merging that release PR creates the `vX.Y.Z` tag and GitHub Release, then dispatches `.github/workflows/publish.yml`, which builds the Windows NSIS installer and attaches it under both the versioned name (`lan-drop_X.Y.Z_x64-setup.exe`) and a stable `lan-drop-setup.exe` copy (for permalink links like `releases/latest/download/lan-drop-setup.exe`). `publish.yml` can also be run manually from the Actions tab to re-publish any tag.

The installer is also signed for the built-in auto-updater: `publish.yml` uploads the `*.sig` signature and a `latest.json` manifest, and the app checks `releases/latest/download/latest.json` on every startup, force-updating (download → install → relaunch) whenever a newer version is published.

## License

MIT — see [LICENSE](./LICENSE).
