// Wire types mirror the Rust structs exactly (serde snake_case, no renames).
// Keep field names byte-identical with src-tauri/src/lib.rs and usb.rs.

export interface ServerInfo {
  /** Loopback plain-HTTP port for the desktop webview's EventSource. */
  loopback_port: number;
  upload_dir: string;
}

export interface UsbDeviceEntry {
  udid: string;
  /** Debug string of the idevice ConnectionType, e.g. "Usb" / "Network". */
  connection: string;
}

export interface UsbDeviceInfo {
  name: string;
  version: string;
}

export interface UsbEntry {
  name: string;
  is_dir: boolean;
  size: number;
}

export interface UsbApp {
  bundle_id: string;
  name: string;
}

/** null = app grid (initial view); media = media partition; app = app Documents. */
export type Scope = null | { type: "media" } | { type: "app"; id: string; name: string };

/** Saved USB-explorer launch location; null = "unset" (launch on the app grid). */
export interface StartPath {
  scope: Exclude<Scope, null>;
  cwd: string[];
}

/** A ticked device item — carries its own location so the selection basket
 *  survives navigation and one bulk pull/delete can span folders. */
export interface SelectedEntry {
  scope: Exclude<Scope, null>;
  cwd: string[];
  name: string;
  is_dir: boolean;
  size: number;
}

/** in = arriving on the PC (upload / pull); out = leaving the PC (push). */
export type TransferDirection = "in" | "out";

export interface Transfer {
  file: string;
  direction: TransferDirection;
  received: number;
  total: number;
  done: boolean;
  /** Final byte size, set when done. */
  size: number;
}
