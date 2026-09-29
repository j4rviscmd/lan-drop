/**
 * Startup force-update initializer.
 *
 * Checks for an update right after launch and, when one exists, blocks the
 * app with a full-screen overlay and runs download → install → relaunch
 * automatically (no confirmation, no skip). Check or download failures are
 * logged and the app starts normally — a broken release feed must not brick
 * the installed app.
 */

import { UpdateOverlay } from "@components/UpdateOverlay";
import { useAppUpdate } from "@hooks/useAppUpdate";
import { useEffect, useRef, useState } from "react";

/**
 * Forces an app update on startup when one is available.
 *
 * @returns null (full-screen overlay only while the update is applied).
 */
export function AppUpdateInitializer() {
  const { status, checkUpdate, install } = useAppUpdate();
  const [version, setVersion] = useState<string | null>(null);
  // Why: guard against StrictMode's double mount running check + download
  // twice (prod doesn't double-fire, but it matters whenever the PROD gate
  // is removed for testing).
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      const update = await checkUpdate();
      if (update) {
        setVersion(update.version);
        await install(update);
      }
    })();
  }, [checkUpdate, install]);

  // Note: status can be "available" while version is still null (separate
  // setState calls), so gate on both; this also narrows the type for
  // UpdateOverlay's version: string.
  const applying =
    version !== null &&
    (status.kind === "available" || status.kind === "downloading" || status.kind === "installing");

  if (!applying) return null;
  return <UpdateOverlay status={status} version={version} />;
}
