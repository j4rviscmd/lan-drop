import { api } from "@lib/api";
import type {
  Scope,
  StartPath,
  TransferDirection,
  UsbApp,
  UsbDeviceEntry,
  UsbEntry,
} from "@lib/types";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

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
    return `/Documents${cw.length ? `/${cw.join("/")}` : ""}`;
  }
  return `/${cw.join("/")}`;
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
) {
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
  /** Ticked file names in the current directory — folders can't be pulled. */
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  // Generation guard: fast navigation can outpace usb_list/usb_apps
  // responses; stale responses must not clobber the newer view.
  const gen = useRef(0);
  // Latest browsed location — lets a finishing push refresh the grid only
  // when the drop-time folder is still on screen (a mid-push navigation
  // must not be yanked back to it).
  const locRef = useRef<{ s: Scope; cw: string[] } | null>(null);

  const browse = useCallback(async (ud: string, s: Scope, cw: string[], fallback = false) => {
    const g = ++gen.current;
    locRef.current = { s, cw };
    setLoading(true);
    // Any navigation invalidates the ticked set.
    setSelected(new Set());
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
  }, []);

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
  const adoptDevices = useCallback(
    async (devs: UsbDeviceEntry[]) => {
      setDevices(devs);
      if (devs.length === 0) {
        // No "then Refresh" nudge: the backend watch picks devices up on its own.
        setStatus(
          "No iPhone found. Plug it in via USB (iTunes or the Apple Devices app must be installed).",
        );
        setUdid(null);
        setPaired(false);
        return;
      }
      setUdid(devs[0].udid);
      await checkPaired(devs[0].udid);
    },
    [checkPaired],
  );

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

  const fullPath = useCallback(
    (name: string) => {
      const r = rel(scope, cwd);
      return `${r === "/" ? "" : r}/${name}`;
    },
    [scope, cwd],
  );

  const pull = useCallback(
    async (en: UsbEntry): Promise<boolean> => {
      if (!udid) return false;
      setStatus(`Pulling ${en.name}…`);
      track(en.name, "in");
      try {
        const dest = await api.usbPull(
          udid,
          fullPath(en.name),
          scope?.type === "app" ? scope.id : null,
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
    [udid, scope, uploadDir, fullPath, track],
  );

  const openEntry = useCallback(
    (en: UsbEntry) => {
      if (en.is_dir) navigate(scope, [...cwd, en.name]);
    },
    [scope, cwd, navigate],
  );

  /** Tick/untick one file or folder for a bulk pull (checkbox UI). */
  const toggleSelect = useCallback((en: UsbEntry) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(en.name)) next.delete(en.name);
      else next.add(en.name);
      return next;
    });
  }, []);

  /** Pull every ticked entry sequentially — one AFC session at a time
   * (a ticked folder recurses inside usb_pull, not here). */
  const pullSelected = useCallback(async () => {
    if (!udid || !entries) return;
    const list = entries.filter((e) => selected.has(e.name));
    if (list.length === 0) return;
    let ok = 0;
    for (const en of list) {
      if (await pull(en)) ok++;
    }
    setSelected(new Set());
    setStatus(`Pulled ${ok}/${list.length} to ${uploadDir}.`);
  }, [udid, entries, selected, pull, uploadDir]);

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
        // Reload the current folder so the listing drops the deleted entry
        // (navigate() re-browses the same scope/cwd and clears the ticks).
        navigate(scope, cwd);
      } catch (e) {
        setStatus(`Delete failed: ${e}`);
        toast.error(`Delete failed: ${e}`);
      }
    },
    [udid, scope, cwd, fullPath, navigate],
  );

  const pushPath = useCallback(
    async (src: string) => {
      if (!udid) return;
      setStatus(`Sending ${src}…`);
      track(src.split(/[\\/]/).pop() ?? src, "out");
      try {
        const inApp = scope?.type === "app";
        await api.usbPush(udid, src, inApp ? "/Documents" : "/lan-drop", inApp ? scope.id : null);
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

  // Mount-only: the initial device scan.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only initial scan; refresh identity intentionally excluded.
  useEffect(() => {
    void refresh();
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
    setSelected,
    toggleSelect,
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
