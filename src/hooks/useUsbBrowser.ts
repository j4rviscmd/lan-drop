import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { api } from "@lib/api";
import type { Scope, StartPath, TransferDirection, UsbApp, UsbDeviceEntry, UsbEntry } from "@lib/types";

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

  // Generation guard: fast navigation can outpace usb_list/usb_apps
  // responses; stale responses must not clobber the newer view.
  const gen = useRef(0);

  const browse = useCallback(
    async (ud: string, s: Scope, cw: string[], fallback = false) => {
      const g = ++gen.current;
      setLoading(true);
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

  const refresh = useCallback(async () => {
    setStatus("Looking for devices…");
    let devs: UsbDeviceEntry[];
    try {
      devs = await api.usbDevices();
    } catch (e) {
      setStatus(String(e));
      return;
    }
    setDevices(devs);
    if (devs.length === 0) {
      setStatus(
        "No iPhone found. Plug it in via USB (iTunes or the Apple Devices app must be installed), then Refresh.",
      );
      setUdid(null);
      setPaired(false);
      return;
    }
    setUdid(devs[0].udid);
    await checkPaired(devs[0].udid);
  }, [checkPaired]);

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
      return (r === "/" ? "" : r) + "/" + name;
    },
    [scope, cwd],
  );

  const pull = useCallback(
    async (en: UsbEntry) => {
      if (!udid) return;
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
      } catch (e) {
        setStatus(`Pull failed: ${e}`);
        toast.error(`Pull failed: ${e}`);
      }
    },
    [udid, scope, uploadDir, fullPath, track],
  );

  const openEntry = useCallback(
    (en: UsbEntry) => {
      if (en.is_dir) {
        const cw = [...cwd, en.name];
        setCwd(cw);
        if (udid) void browse(udid, scope, cw);
      } else {
        void pull(en);
      }
    },
    [udid, cwd, scope, browse, pull],
  );

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
      } catch (e) {
        setStatus(`Push failed: ${e}`);
        toast.error(`Push failed: ${e}`);
      }
    },
    [udid, scope, track],
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

  useEffect(() => {
    void refresh();
    // Mount-only: the initial device scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
