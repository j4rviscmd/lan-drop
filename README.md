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

## Windows firewall

The app listens on `0.0.0.0` (TCP 8787–8799) for LAN transfers, so Windows shows the "allow this app to communicate" dialog when no allow rule exists. The NSIS installer registers a program-scoped inbound allow rule during setup (one UAC prompt), so installed builds never show the dialog.

Dev builds change on every rebuild, which invalidates the rule the dialog creates. Register a port-scoped rule once (in an admin terminal) to silence it for good:

```powershell
netsh advfirewall firewall add rule name="lan-drop (dev)" dir=in action=allow protocol=TCP localport=8787-8799 profile=any
```

Remove it with `netsh advfirewall firewall delete rule name="lan-drop (dev)"`. If the dialog still appears, delete stale `lan-drop` block rules in "Windows Defender Firewall with Advanced Security" (a cancelled dialog can leave a program Block rule that outranks allow rules).

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
