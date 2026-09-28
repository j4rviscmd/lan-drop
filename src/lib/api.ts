import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";

import type { ServerInfo, UsbApp, UsbDeviceEntry, UsbDeviceInfo, UsbEntry } from "./types";

// Tauri converts camelCase JS args to snake_case Rust params (destDir →
// dest_dir, afcDir → afc_dir). `app` must be null — not undefined — for
// Rust's Option<String> to deserialize as None.
export const api = {
  /** Switch the upload destination; returns the display path. */
  setUploadDir: (path: string) => invoke<string>("set_upload_dir", { path }),
  serverInfo: () => invoke<ServerInfo>("server_info"),

  usbDevices: () => invoke<UsbDeviceEntry[]>("usb_devices"),
  /** Backend pushes the usbmuxd device set whenever it changes (watch_devices). */
  onUsbDevices: (cb: (devs: UsbDeviceEntry[]) => void): Promise<() => void> =>
    listen<UsbDeviceEntry[]>("usb-devices", (e) => cb(e.payload)),
  usbDeviceInfo: (udid: string) =>
    invoke<UsbDeviceInfo>("usb_device_info", { udid }),
  usbPair: (udid: string) => invoke<void>("usb_pair", { udid }),

  usbApps: (udid: string) => invoke<UsbApp[]>("usb_apps", { udid }),
  usbList: (udid: string, path: string, app: string | null) =>
    invoke<UsbEntry[]>("usb_list", { udid, path, app }),
  usbThumbnail: (udid: string, path: string, app: string | null) =>
    invoke<string | null>("usb_thumbnail", { udid, path, app }),

  usbPull: (udid: string, path: string, app: string | null, destDir: string) =>
    invoke<string>("usb_pull", { udid, path, app, destDir }),
  usbPush: (udid: string, src: string, afcDir: string, app: string | null) =>
    invoke<void>("usb_push", { udid, src, afcDir, app }),
  /** Deletes a file, or a directory with everything inside it. */
  usbDelete: (udid: string, path: string, app: string | null) =>
    invoke<void>("usb_delete", { udid, path, app }),

  /** Native file picker; returns the absolute path or null when cancelled. */
  pickFile: async (): Promise<string | null> => {
    const file = await openFileDialog({ multiple: false });
    return typeof file === "string" ? file : null;
  },

  /** Native folder picker; returns the absolute path or null when cancelled. */
  pickFolder: async (): Promise<string | null> => {
    const dir = await openFileDialog({ directory: true });
    return typeof dir === "string" ? dir : null;
  },
};
