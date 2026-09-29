/**
 * Full-screen overlay shown while a forced update is being applied.
 *
 * Blocks interaction during the download + relaunch so the app neither looks
 * frozen nor loses pre-restart actions. There is no dismiss path: the app
 * relaunches automatically once the install finishes.
 */
import type { UpdateStatus } from "@hooks/useAppUpdate";
import { fmtSize } from "@lib/format";
import { Progress } from "@ui/progress";

type Props = {
  /** Current update-flow state (available / downloading / installing). */
  status: Extract<UpdateStatus, { kind: "available" | "downloading" | "installing" }>;
  /** The version being applied. */
  version: string;
};

/**
 * Renders a blocking overlay while a forced update is being applied.
 *
 * @returns Full-screen overlay covering the app during the update.
 */
export function UpdateOverlay({ status, version }: Props) {
  const received = status.kind === "downloading" ? status.received : 0;
  const total = status.kind === "downloading" ? status.total : null;
  const pct = total ? Math.min(100, (received / total) * 100) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-4 rounded-lg border p-6 text-center">
        <h2 className="text-lg font-semibold">Applying update {version}</h2>
        <p className="text-sm text-muted-foreground">
          {status.kind === "installing"
            ? "Installing… the app restarts when done"
            : "Downloading… the app restarts automatically when done"}
        </p>
        {/* Note: without a content length the percentage is unknowable, so
            show a pulsing full-width bar instead of a stuck value. */}
        <Progress value={pct ?? 100} className={pct === null ? "animate-pulse" : undefined} />
        {status.kind === "downloading" && (
          <p className="text-sm text-muted-foreground tabular-nums">
            {fmtSize(received)}
            {total ? ` / ${fmtSize(total)}` : ""}
          </p>
        )}
      </div>
    </div>
  );
}
