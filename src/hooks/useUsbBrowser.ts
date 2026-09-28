import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";

import { api } from "@lib/api";
import type {
  Scope,
  SelectedEntry,
  StartPath,
  TransferDirection,
  UsbApp,
  UsbDeviceEntry,
  UsbEntry,
} from "@lib/types";

export type UsbView = "grid" | "list";

/// Why: only 'list' is persisted — grid is the default view, and any other
/// stored value (or none) falls back to it.
function initialView(): UsbView {
  return localStorage.getItem("usb-view") === "list" ? "list" : "grid";
}

const START_PATH_KEY = "usb-start-path";

// Why: localStorage is untrusted — a malformed or outdated entry must read
// as "unset" instead of breaking the launch navigation.
function parseScope(raw: unknown): Exclude<Scope, null> | null {
  if (typeof raw !== "object" || raw === null || !("type" in raw)) return null;
  if (raw.type === "media") return { type: "media" };
  if (
    raw.type === "app" &&
    "id" in raw &&
    typeof raw.id === "string" &&
    "name" in raw &&
    typeof raw.name === "string"
  ) {
    return { type: "app", id: raw.id, name: raw.name };
  }
  return null;
}

function readStartPath(): StartPath | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(START_PATH_KEY) ?? "null");
    if (typeof raw !== "object" || raw === null || !("scope" in raw)) return null;
    const scope = parseScope(raw.scope);
    if (!scope) return null;
    const cw = "cwd" in raw && Array.isArray(raw.cwd) ? raw.cwd : [];
    return { scope, cwd: cw.filter((c): c is string => typeof c === "string") };
  } catch {
    return null;
  }
}

// VendDocuments roots the AFC session at the app container but only exposes
// the Documents subtree — so app-scope paths live under /Documents.
function rel(s: Scope, cw: string[]): string {
  if (s?.type === "app") {
    return "/Documents" + (cw.length ? "/" + cw.join("/") : "");
  }
  return "/" + cw.join("/");
}

/** Stable identity of a place on the device: "media" or "app:<bundle id>". */
function scopeKeyOf(s: Scope): string {
  return s?.type === "app" ? `app:${s.id}` : "media";
}

/** Basket key — unique per (scope, folder, name); the JSON form can't be
 *  forged by a file name containing separators. */
export function selKey(s: Scope, cw: string[], name: string): string {
  return JSON.stringify([scopeKeyOf(s), cw, name]);
}

/** True when both (scope, cwd) pairs name the same device folder. */
function samePlace(s1: Scope, cw1: string[], s2: Scope, cw2: string[]): boolean {
  if (scopeKeyOf(s1) !== scopeKeyOf(s2)) return false;
  return cw1.length === cw2.length && cw1.every((c, i) => c === cw2[i]);
}

/** Absolute device path of an entry. */
export function pathOf(s: Scope, cw: string[], name: string): string {
  const r = rel(s, cw);
  return (r === "/" ? "" : r) + "/" + name;
}

/** The USB browser API consumed by Shell, ExplorerCard and SelectionCard. */
export interface UsbBrowser {
  devices: UsbDeviceEntry[];
  udid: string | null;
  paired: boolean;
  scope: Scope;
  cwd: string[];
  navigate: (s: Scope, cw: string[]) => void;
  pathFor: (name: string) => string;
  noAccess: ReadonlySet<string>;
  view: UsbView;
  status: string;
  loading: boolean;
  apps: UsbApp[] | null;
  entries: UsbEntry[] | null;
  /** Cross-folder ticked basket — key = selKey(scope, cwd, name). */
  selected: ReadonlyMap<string, SelectedEntry>;
  /** Ticked names in the current folder (row checkboxes, "x/y here"). */
  selectedHere: ReadonlySet<string>;
  toggleSelect: (en: UsbEntry) => void;
  toggleAll: (list: UsbEntry[], on: boolean) => void;
  removeSelected: (key: string) => void;
  clearSelection: () => void;
  deleteSelected: () => Promise<void>;
  pullSelected: () => Promise<void>;
  pull: (en: UsbEntry) => Promise<boolean>;
  deleteEntry: (en: UsbEntry) => Promise<void>;
  refresh: () => Promise<void>;
  pair: () => Promise<void>;
  selectDevice: (ud: string) => void;
  openRoot: () => void;
  openApp: (app: UsbApp) => void;
  openMedia: () => void;
  openEntry: (en: UsbEntry) => void;
  pushPath: (src: string) => Promise<void>;
  pickAndPush: () => Promise<void>;
  setView: (v: UsbView) => void;
  startPath: StartPath | null;
  saveStartPath: () => void;
  clearStartPath: () => void;
}

/**
 * The USB browser state machine — a port of the vanilla-JS flow in the old
 * src/main.js. Status strings, error regexes and the /Documents app-scope
 * prefix are behavioral contracts; change them only with device testing.
 *
 * `ud` is passed explicitly through every action so a device switch can
 * browse with the new udid before React commits the state update.
 */
export function useUsbBrowser(
  uploadDir: string,
  track: (file: string, direction: TransferDirection) => void,
): UsbBrowser {
  const [devices, setDevices] = useState<UsbDeviceEntry[]>([]);
  const [udid, setUdid] = useState<string | null>(null);
  const [paired, setPaired] = useState(false);
  const [scope, setScope] = useState<Scope>(null);
  const [cwd, setCwd] = useState<string[]>([]);
  // Apps that rejected house_arrest this session (iOS hides non-file-sharing apps).
  const [noAccess, setNoAccess] = useState<ReadonlySet<string>>(() => new Set());
  const [view, setViewState] = useState<UsbView>(initialView);
  const [startPath, setStartPath] = useState<StartPath | null>(readStartPath);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  /** apps = the initial scope tile grid; entries = a browsed directory. */
  const [apps, setApps] = useState<UsbApp[] | null>(null);
  const [entries, setEntries] = useState<UsbEntry[] | null>(null);
  /** Ticked entries across folders — a basket that survives navigation so
   *  one bulk pull/delete can span paths. Key = selKey(scope, cwd, name). */
  const [selected, setSelected] = useState<ReadonlyMap<string, SelectedEntry>>(() => new Map());

  // Generation guard: fast navigation can outpace usb_list/usb_apps
  // responses; stale responses must not clobber the newer view.
  const gen = useRef(0);
  // Latest browsed location — lets a finishing push refresh the grid only
  // when the drop-time folder is still on screen (a mid-push navigation
  // must not be yanked back to it).
  const locRef = useRef<{ s: Scope; cw: string[] } | null>(null);

  const browse = useCallback(
    async (ud: string, s: Scope, cw: string[], fallback = false) => {
      const g = ++gen.current;
      locRef.current = { s, cw };
      setLoading(true);
      // Navigation resets the listing; the ticked basket survives it.
      setApps(null);
      setEntries(null);
      try {
        if (!s) {
          const list = await api.usbApps(ud);
          if (g !== gen.current) return;
          setApps(list);
          return;
        }
        const list = await api.usbList(ud, rel(s, cw), s.type === "app" ? s.id : null);
        if (g !== gen.current) return;
        setEntries(list);
      } catch (e) {
        if (g !== gen.current) return;
        // Fresh installs may not have a Documents folder yet.
        if (s?.type === "app" && cw.length === 0 && /not found|no such/i.test(String(e))) {
          setEntries([]);
          setStatus(`${s.name} has no shared Documents yet.`);
          return;
        }
        // iOS reports non-file-sharing apps to house_arrest as InstallationLookupFailed.
        if (s?.type === "app" && String(e).includes("InstallationLookupFailed")) {
          setNoAccess((prev) => new Set(prev).add(s.id));
          setScope(null);
          setCwd([]);
          setStatus(`${s.name} doesn't allow file access — iOS only exposes file-sharing apps.`);
          await browse(ud, null, []);
          return;
        }
        // Saved startup folder is stale (folder/app gone): land on its
        // scope root, or the app grid when the scope root itself failed.
        if (fallback && s) {
          setStatus("Saved startup folder is unavailable.");
          const next = cw.length > 0 ? s : null;
          setScope(next);
          setCwd([]);
          await browse(ud, next, []);
          return;
        }
        setStatus(`Cannot browse: ${e}`);
      } finally {
        if (g === gen.current) setLoading(false);
      }
    },
    [],
  );

  /** Every navigation funnels through here: set scope + cwd, then browse. */
  const go = useCallback(
    async (ud: string, s: Scope, cw: string[] = [], fallback = false) => {
      setScope(s);
      setCwd(cw);
      await browse(ud, s, cw, fallback);
    },
    [browse],
  );

  const checkPaired = useCallback(
    async (ud: string) => {
      setStatus("Checking pairing…");
      try {
        const info = await api.usbDeviceInfo(ud);
        setStatus(`Paired · ${info.name} · iOS ${info.version}`);
        setPaired(true);
        // Startup default: open the saved folder instead of the app grid.
        await (startPath ? go(ud, startPath.scope, startPath.cwd, true) : go(ud, null));
      } catch {
        setStatus('Not paired yet — press Pair, unlock the iPhone, then tap "Trust" on it.');
        setPaired(false);
      }
    },
    [go, startPath],
  );

  /** Publish a device set and select the first device (or clear when none) —
   *  the shared tail of refresh() and the pushed-set handler. */
  const adoptDevices = useCallback(async (devs: UsbDeviceEntry[]) => {
    setDevices(devs);
    // A new or vanished device invalidates every ticked path.
    setSelected(new Map());
    if (devs.length === 0) {
      // No "then Refresh" nudge: the backend watch picks devices up on its own.
      setStatus("No iPhone found. Plug it in via USB (iTunes or the Apple Devices app must be installed).");
      setUdid(null);
      setPaired(false);
      return;
    }
    setUdid(devs[0].udid);
    await checkPaired(devs[0].udid);
  }, [checkPaired]);

  const refresh = useCallback(async () => {
    setStatus("Looking for devices…");
    let devs: UsbDeviceEntry[];
    try {
      devs = await api.usbDevices();
    } catch (e) {
      setStatus(String(e));
      return;
    }
    await adoptDevices(devs);
  }, [adoptDevices]);

  /** React to a backend-pushed device set (usbmuxd watch). Keeps an intact
   *  selection silent — no status churn, no navigation reset; the full
   *  select+checkPaired flow runs only when a device appears with none
   *  selected or the selection vanished. */
  const applyDevices = useCallback(
    async (devs: UsbDeviceEntry[]) => {
      if (udid && devs.some((d) => d.udid === udid)) {
        setDevices(devs);
        return;
      }
      await adoptDevices(devs);
    },
    [udid, adoptDevices],
  );

  const pair = useCallback(async () => {
    if (!udid) return;
    setStatus("Pairing… unlock the iPhone and tap \u201cTrust\u201d when it asks.");
    try {
      await api.usbPair(udid);
      setStatus("Paired.");
      await checkPaired(udid);
    } catch (e) {
      setStatus(`Pairing failed: ${e}`);
    }
  }, [udid, checkPaired]);

  /** Switching devices keeps the browser open (vanilla-JS parity). */
  const selectDevice = useCallback(
    (ud: string) => {
      setUdid(ud);
      setSelected(new Map()); // Paths are device-bound.
      void go(ud, null);
    },
    [go],
  );

  const openRoot = useCallback(() => {
    if (!udid) return;
    void go(udid, null);
  }, [udid, go]);

  const openApp = useCallback(
    (app: UsbApp) => {
      if (!udid) return;
      if (noAccess.has(app.bundle_id)) {
        setStatus(`${app.name} doesn't allow file access — iOS only exposes file-sharing apps.`);
        return;
      }
      void go(udid, { type: "app", id: app.bundle_id, name: app.name });
    },
    [udid, noAccess, go],
  );

  const openMedia = useCallback(() => {
    if (!udid) return;
    void go(udid, { type: "media" });
  }, [udid, go]);

  /** Navigate to an arbitrary (scope, cwd) — used by the breadcrumbs. */
  const navigate = useCallback(
    (s: Scope, cw: string[]) => {
      if (!udid) return;
      void go(udid, s, cw);
    },
    [udid, go],
  );

  const fullPath = useCallback((name: string) => pathOf(scope, cwd, name), [scope, cwd]);

  /** Pull one basket item to the PC — single save and bulk pull share this. */
  const pullItem = useCallback(
    async (it: SelectedEntry): Promise<boolean> => {
      if (!udid) return false;
      setStatus(`Pulling ${it.name}…`);
      track(it.name, "in");
      try {
        const dest = await api.usbPull(
          udid,
          pathOf(it.scope, it.cwd, it.name),
          it.scope.type === "app" ? it.scope.id : null,
          uploadDir,
        );
        setStatus(`Saved to ${dest}`);
        toast.success(`Saved to ${dest}`);
        return true;
      } catch (e) {
        setStatus(`Pull failed: ${e}`);
        toast.error(`Pull failed: ${e}`);
        return false;
      }
    },
    [udid, uploadDir, track],
  );

  const pull = useCallback(
    async (en: UsbEntry): Promise<boolean> => {
      if (!scope) return false;
      return pullItem({ scope, cwd, name: en.name, is_dir: en.is_dir, size: en.size });
    },
    [scope, cwd, pullItem],
  );

  const openEntry = useCallback(
    (en: UsbEntry) => {
      if (en.is_dir) navigate(scope, [...cwd, en.name]);
    },
    [scope, cwd, navigate],
  );

  /** Tick/untick one file or folder — remembers its folder so the basket
   *  survives navigation (checkbox UI). */
  const toggleSelect = useCallback(
    (en: UsbEntry) => {
      if (!scope) return;
      const k = selKey(scope, cwd, en.name);
      setSelected((prev) => {
        const next = new Map(prev);
        if (next.has(k)) next.delete(k);
        else next.set(k, { scope, cwd, name: en.name, is_dir: en.is_dir, size: en.size });
        return next;
      });
    },
    [scope, cwd],
  );

  /** Select-all checkbox for the visible listing: ticks every given entry,
   *  or unticks just this folder's ticks (other folders keep theirs). */
  const toggleAll = useCallback(
    (list: UsbEntry[], on: boolean) => {
      if (!scope) return;
      setSelected((prev) => {
        const next = new Map(prev);
        for (const en of list) {
          const k = selKey(scope, cwd, en.name);
          if (on) next.set(k, { scope, cwd, name: en.name, is_dir: en.is_dir, size: en.size });
          else next.delete(k);
        }
        return next;
      });
    },
    [scope, cwd],
  );

  /** Untick one basket item (the × row button in the Selected card). */
  const removeSelected = useCallback((k: string) => {
    setSelected((prev) => {
      const next = new Map(prev);
      next.delete(k);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Map()), []);

  /** Pull every ticked entry sequentially — one AFC session at a time
   *  (a ticked folder recurses inside usb_pull, not here). Successfully
   *  pulled items untick; failures stay ticked for a retry. */
  const pullSelected = useCallback(async () => {
    if (!udid) return;
    const items = [...selected.values()];
    if (items.length === 0) return;
    let ok = 0;
    for (const it of items) {
      if (await pullItem(it)) {
        ok++;
        removeSelected(selKey(it.scope, it.cwd, it.name));
      }
    }
    setStatus(`Pulled ${ok}/${items.length} to ${uploadDir}.`);
  }, [udid, selected, pullItem, removeSelected, uploadDir]);

  /** Native-confirm, delete on the device, then reload the listing. */
  const deleteEntry = useCallback(
    async (en: UsbEntry) => {
      if (!udid) return;
      const msg = en.is_dir
        ? `Delete "${en.name}" and everything inside it from the device?`
        : `Delete "${en.name}" from the device?`;
      if (!(await confirm(msg, { title: "Delete from device", kind: "warning" }))) return;
      try {
        await api.usbDelete(udid, fullPath(en.name), scope?.type === "app" ? scope.id : null);
        toast.success(`Deleted ${en.name}.`);
        // Drop the tick too — navigation no longer clears the basket.
        if (scope) removeSelected(selKey(scope, cwd, en.name));
        // Reload the current folder so the listing drops the deleted entry.
        navigate(scope, cwd);
      } catch (e) {
        setStatus(`Delete failed: ${e}`);
        toast.error(`Delete failed: ${e}`);
      }
    },
    [udid, scope, cwd, fullPath, navigate, removeSelected],
  );

  /** One native confirm for the whole basket, then delete each item on the
   *  device. Failures stay ticked; the current folder reloads on success. */
  const deleteSelected = useCallback(async () => {
    if (!udid) return;
    const items = [...selected.values()];
    if (items.length === 0) return;
    const n = items.length;
    const folders = items.some((i) => i.is_dir);
    const msg =
      `Delete ${n} selected item${n > 1 ? "s" : ""}` +
      (folders ? " — folders delete everything inside them" : "") +
      " from the device?";
    if (!(await confirm(msg, { title: "Delete from device", kind: "warning" }))) return;
    let ok = 0;
    for (const it of items) {
      try {
        await api.usbDelete(
          udid,
          pathOf(it.scope, it.cwd, it.name),
          it.scope.type === "app" ? it.scope.id : null,
        );
        ok++;
        removeSelected(selKey(it.scope, it.cwd, it.name));
      } catch (e) {
        setStatus(`Delete failed for ${it.name}: ${e}`);
        toast.error(`Delete failed for ${it.name}`);
      }
    }
    if (ok > 0) {
      toast.success(`Deleted ${ok}/${n}.`);
      if (scope) navigate(scope, cwd);
    }
  }, [udid, selected, scope, cwd, navigate, removeSelected]);

  const pushPath = useCallback(
    async (src: string) => {
      if (!udid) return;
      setStatus(`Sending ${src}…`);
      track(src.split(/[\\/]/).pop() ?? src, "out");
      try {
        const inApp = scope?.type === "app";
        await api.usbPush(
          udid,
          src,
          inApp ? "/Documents" : "/lan-drop",
          inApp ? scope.id : null,
        );
        const msg = inApp
          ? `Sent into ${scope.name} (Documents).`
          : 'Sent to the phone (media partition, folder "lan-drop").';
        setStatus(msg);
        toast.success(msg);
        // Why: the grid shows a stale listing otherwise — the pushed file
        // only reappeared after a reconnect (checkPaired re-lists). Refresh
        // only the drop-time folder, and only while it is still the
        // current view.
        const loc = locRef.current;
        if (loc && loc.s === scope && loc.cw.join("/") === cwd.join("/")) {
          await browse(udid, scope, cwd);
        }
      } catch (e) {
        setStatus(`Push failed: ${e}`);
        toast.error(`Push failed: ${e}`);
      }
    },
    [udid, scope, cwd, browse, track],
  );

  const pickAndPush = useCallback(async () => {
    const file = await api.pickFile();
    if (!file) return;
    await pushPath(file);
  }, [pushPath]);

  const setView = useCallback((v: UsbView) => {
    setViewState(v);
    localStorage.setItem("usb-view", v);
  }, []);

  /** Register the currently browsed location as the launch default. */
  const saveStartPath = useCallback(() => {
    if (!scope) return;
    const sp: StartPath = { scope, cwd };
    localStorage.setItem(START_PATH_KEY, JSON.stringify(sp));
    setStartPath(sp);
    toast.success("Startup folder saved.");
  }, [scope, cwd]);

  const clearStartPath = useCallback(() => {
    localStorage.removeItem(START_PATH_KEY);
    setStartPath(null);
  }, []);

  // Ticked names in the current folder — drives the row checkboxes and the
  // "x/y here" counter; the full cross-folder basket renders in the
  // SelectionCard.
  const selectedHere = useMemo(() => {
    const here = new Set<string>();
    if (!scope) return here;
    for (const it of selected.values()) {
      if (samePlace(it.scope, it.cwd, scope, cwd)) here.add(it.name);
    }
    return here;
  }, [selected, scope, cwd]);

  useEffect(() => {
    void refresh();
    // Mount-only: the initial device scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Backend "usb-devices" pushes (3s usbmuxd watch in Rust — the frontend
  // never polls). Cleanup also covers listen() resolving after unmount.
  useEffect(() => {
    const unlisten = api.onUsbDevices((devs) => void applyDevices(devs));
    return () => {
      void unlisten.then((f) => f());
    };
  }, [applyDevices]);

  return {
    devices,
    udid,
    paired,
    scope,
    cwd,
    navigate,
    pathFor: fullPath,
    noAccess,
    view,
    status,
    loading,
    apps,
    entries,
    selected,
    selectedHere,
    toggleSelect,
    toggleAll,
    removeSelected,
    clearSelection,
    deleteSelected,
    pullSelected,
    pull,
    deleteEntry,
    refresh,
    pair,
    selectDevice,
    openRoot,
    openApp,
    openMedia,
    openEntry,
    pushPath,
    pickAndPush,
    setView,
    startPath,
    saveStartPath,
    clearStartPath,
  };
}
