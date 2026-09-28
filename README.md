# lan-drop

Windows ⇄ iPhone file transfer app built with Tauri 2.0. See [DESIGN.md](./DESIGN.md) for the architecture.

## Frontend stack

React 19 + TypeScript + Vite 6 + Tailwind CSS v4, with [ObsidianUI](https://www.obsidianui.dev/) components (shadcn-style copy-paste registry, MIT).

## Development

```bash
npm install
npm run tauri dev
```

`npm run build` type-checks and bundles the frontend into `dist/` (wired to Tauri via `src-tauri/tauri.conf.json`).

## Lint and formatting

- `npm run lint` — [Biome](https://biomejs.dev/) lint over the frontend (strict: warnings fail).
- `npm run format` — Biome format; `cargo fmt` (in `src-tauri/`) covers the Rust side.
- A pre-commit hook (`.githooks/pre-commit`, enabled automatically via the `prepare` script) runs both formatters and stages the result before every commit.

CI (`.github/workflows/ci.yml`) runs lint, frontend build, `cargo clippy -D warnings`, and `cargo test` on `windows-latest`. The workflow ships disabled (`workflow_dispatch` only) until the repository goes public — uncomment the `push`/`pull_request` triggers in the file to enable it.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
