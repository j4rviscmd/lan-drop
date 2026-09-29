/**
 * Shared app-update logic: check → download → install → relaunch via the
 * updater plugin. Used by the startup force-update (AppUpdateInitializer).
 * Endpoint + pubkey live in tauri.conf.json (plugins.updater).
 */
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useCallback, useState } from "react";

/** Update-flow state; downloading bytes are accumulated from Progress events. */
export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "up-to-date" }
  | { kind: "available"; update: Update }
  | { kind: "downloading"; received: number; total: number | null }
  | { kind: "installing" }
  | { kind: "error"; message: string };

/**
 * Check for updates and apply them.
 *
 * @returns status — the current update-flow state / checkUpdate — look for an
 *   update / install — download through relaunch.
 */
export function useAppUpdate() {
  const [status, setStatus] = useState<UpdateStatus>({ kind: "idle" });

  /**
   * Check for an update.
   *
   * @returns the available update, or null. Errors surface in status.
   */
  const checkUpdate = useCallback(async (): Promise<Update | null> => {
    setStatus({ kind: "checking" });
    try {
      const update = await check();
      console.log(
        "[updater] check:",
        update ? `update available: ${update.version}` : "up-to-date",
      );
      setStatus(update ? { kind: "available", update } : { kind: "up-to-date" });
      return update;
    } catch (e) {
      console.error("[updater] check failed:", e);
      setStatus({ kind: "error", message: String(e) });
      return null;
    }
  }, []);

  /**
   * Download, install, and relaunch. Errors surface in status (never thrown).
   *
   * @param update - the update returned by checkUpdate
   */
  const install = useCallback(async (update: Update): Promise<void> => {
    setStatus({ kind: "downloading", received: 0, total: null });
    try {
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            setStatus({
              kind: "downloading",
              received: 0,
              total: event.data.contentLength ?? null,
            });
            break;
          case "Progress":
            // Progress events only carry the chunk length; keep a running total.
            setStatus((prev) =>
              prev.kind === "downloading"
                ? { ...prev, received: prev.received + event.data.chunkLength }
                : prev,
            );
            break;
          case "Finished":
            setStatus({ kind: "installing" });
            break;
        }
      });
      // The running process is still the old binary until relaunch.
      await relaunch();
    } catch (e) {
      console.error("[updater] install failed:", e);
      // Note: intentional fail-open — error status unmounts the update
      // overlay so the app continues on the current version.
      setStatus({ kind: "error", message: String(e) });
    }
  }, []);

  return { status, checkUpdate, install };
}
