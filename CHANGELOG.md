# Changelog

## [1.2.0](https://github.com/j4rviscmd/lan-drop/compare/v1.1.0...v1.2.0) (2026-09-29)


### Features

* show total selected file size in SelectionCard header ([#46](https://github.com/j4rviscmd/lan-drop/issues/46)) ([36a8b30](https://github.com/j4rviscmd/lan-drop/commit/36a8b30a0cac75b182ba67ff05792a0d226bce82))

## [1.1.0](https://github.com/j4rviscmd/lan-drop/compare/v1.0.0...v1.1.0) (2026-09-29)


### Features

* add startup auto-updater with forced update flow ([#36](https://github.com/j4rviscmd/lan-drop/issues/36)) ([a6192ec](https://github.com/j4rviscmd/lan-drop/commit/a6192ecf8b002bbc2cefcf8444edf44894a2984b))

## [1.0.0](https://github.com/j4rviscmd/lan-drop/compare/v0.1.0...v1.0.0) (2026-09-29)


### ⚠ BREAKING CHANGES

* remove browser LAN upload path and local CA ([#19](https://github.com/j4rviscmd/lan-drop/issues/19))
* remove PC-to-phone Wi-Fi file serving ([#16](https://github.com/j4rviscmd/lan-drop/issues/16))

### Features

* add debug-only MCP bridge for AI-assisted debugging ([#11](https://github.com/j4rviscmd/lan-drop/issues/11)) ([1230e89](https://github.com/j4rviscmd/lan-drop/commit/1230e895739d9e91c51dc10e81480c7ce47a7d52))
* add right-click context menu and folder actions to USB explorer ([#21](https://github.com/j4rviscmd/lan-drop/issues/21)) ([bee276a](https://github.com/j4rviscmd/lan-drop/commit/bee276adce9c54a214470c4de4c902422e45a384))
* auto-detect iPhone via backend usbmuxd device watch ([#12](https://github.com/j4rviscmd/lan-drop/issues/12)) ([2a44165](https://github.com/j4rviscmd/lan-drop/commit/2a4416574e47ff584194346869209a9d19244043))
* clear USB explorer search box on navigation ([#8](https://github.com/j4rviscmd/lan-drop/issues/8)) ([5b5a41c](https://github.com/j4rviscmd/lan-drop/commit/5b5a41c058ad4124f55d6b88ece7c628d62da84b))
* grid explorer with per-app Documents browsing and thumbnails ([#4](https://github.com/j4rviscmd/lan-drop/issues/4)) ([adaf476](https://github.com/j4rviscmd/lan-drop/commit/adaf476ca800acb5cb3b2a33773878710dae8193))
* keep selection as a cross-folder basket with a bulk-actions panel ([#26](https://github.com/j4rviscmd/lan-drop/issues/26)) ([c52b85d](https://github.com/j4rviscmd/lan-drop/commit/c52b85de0fe1d01f6d74f4b715bfe53b25b3b8b2))
* make upload destination user-configurable ([#17](https://github.com/j4rviscmd/lan-drop/issues/17)) ([4b6c33d](https://github.com/j4rviscmd/lan-drop/commit/4b6c33deea0cb6064a76822ddd37988b40ea46ef))
* migrate frontend to React + TypeScript with ObsidianUI ([#5](https://github.com/j4rviscmd/lan-drop/issues/5)) ([25c723e](https://github.com/j4rviscmd/lan-drop/commit/25c723e197247b14b256753bed3d90224dc3e50f))
* MVP — HTTPS LAN transfer + USB iPhone mode ([#3](https://github.com/j4rviscmd/lan-drop/issues/3)) ([6d021a0](https://github.com/j4rviscmd/lan-drop/commit/6d021a02dfe0b73f6a5ec10af9408cfde817c10c))
* register USB explorer startup folder in settings dialog ([#9](https://github.com/j4rviscmd/lan-drop/issues/9)) ([6730801](https://github.com/j4rviscmd/lan-drop/commit/6730801731fa6fae95934179029b25ee043921d6))
* register Windows firewall allow rule via NSIS installer hook ([#13](https://github.com/j4rviscmd/lan-drop/issues/13)) ([ad9c15d](https://github.com/j4rviscmd/lan-drop/commit/ad9c15dd939d45b96fe4fec304ca770d123c9a26))
* remove browser LAN upload path and local CA ([#19](https://github.com/j4rviscmd/lan-drop/issues/19)) ([5346f67](https://github.com/j4rviscmd/lan-drop/commit/5346f67f0c1286346c05a80105b86f3c115263b8))
* remove PC-to-phone Wi-Fi file serving ([#16](https://github.com/j4rviscmd/lan-drop/issues/16)) ([c7d63f9](https://github.com/j4rviscmd/lan-drop/commit/c7d63f9ae33bb100bd4473af83d97e72f01162d4))
* replace default Tauri icon with lan-drop transfer icon set ([#28](https://github.com/j4rviscmd/lan-drop/issues/28)) ([dce1c0a](https://github.com/j4rviscmd/lan-drop/commit/dce1c0ad0cef62fe4dfafc7487c84b07272f1f29))
* reveal maximized window in foreground on startup ([#24](https://github.com/j4rviscmd/lan-drop/issues/24)) ([44f53ba](https://github.com/j4rviscmd/lan-drop/commit/44f53baa694de7ee907316fa9914029872cc9f47))
* select files with checkboxes and pull in bulk ([#10](https://github.com/j4rviscmd/lan-drop/issues/10)) ([2ff9e4e](https://github.com/j4rviscmd/lan-drop/commit/2ff9e4e917754e78449c978c3ff51c65806ff3f8))
* start window maximized ([#6](https://github.com/j4rviscmd/lan-drop/issues/6)) ([91a18d6](https://github.com/j4rviscmd/lan-drop/commit/91a18d6e9394ffa050db11ef9ddc4e7c539bc66f))
* stretch Selected/Transfers cards to split the left rail 1:1 ([#29](https://github.com/j4rviscmd/lan-drop/issues/29)) ([1c2d3e7](https://github.com/j4rviscmd/lan-drop/commit/1c2d3e73b1d109366c1394ab2312d878a6f9bde5))


### Bug Fixes

* hide Pair button when the device is already paired ([#15](https://github.com/j4rviscmd/lan-drop/issues/15)) ([eb7ce02](https://github.com/j4rviscmd/lan-drop/commit/eb7ce021f150355a6de80f0824f9878dcf8bf732))
* keep toolbar controls anchored when selection counter changes ([#23](https://github.com/j4rviscmd/lan-drop/issues/23)) ([d2912bd](https://github.com/j4rviscmd/lan-drop/commit/d2912bd7bedabe41598bb64c5d47c4bcef404f68))
* re-list current directory after USB push so dropped files appear immediately ([#22](https://github.com/j4rviscmd/lan-drop/issues/22)) ([db8de2d](https://github.com/j4rviscmd/lan-drop/commit/db8de2d6f1ac2575e70ee3954e1394462ca69a21))
* recursively push dropped folders instead of creating empty 0B files ([#25](https://github.com/j4rviscmd/lan-drop/issues/25)) ([36ab233](https://github.com/j4rviscmd/lan-drop/commit/36ab2334f9f10f411ac379bd36d5dc3711cfe476))
* show a single toast when pulling a file to PC ([#14](https://github.com/j4rviscmd/lan-drop/issues/14)) ([6a7e2e8](https://github.com/j4rviscmd/lan-drop/commit/6a7e2e8f0e9fb01a90f2452500850543b82b75e4))
* virtualize the device file listing to keep checkbox toggles snappy ([#18](https://github.com/j4rviscmd/lan-drop/issues/18)) ([e64e742](https://github.com/j4rviscmd/lan-drop/commit/e64e742f3b8ffd1b64923e897505952af7588b26))
