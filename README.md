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

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
