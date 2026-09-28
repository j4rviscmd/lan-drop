import type { StartPath } from "@lib/types";
import { Button } from "@ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@ui/dialog";
import { Settings2 } from "lucide-react";

/** Human-readable form of a saved launch location ("VLC · Documents / Movies"). */
// Note: app scopes always display under "Documents" — VendDocuments roots the
// AFC session at the app container with only /Documents readable (see rel()
// in useUsbBrowser), so every app path is implicitly inside it.
function formatStartPath(sp: StartPath | null): string {
  if (!sp) return "App grid (not set)";
  const base = sp.scope.type === "app" ? `${sp.scope.name} · Documents` : "Media partition";
  return sp.cwd.length ? `${base} / ${sp.cwd.join(" / ")}` : base;
}

export function SettingsDialog({
  startPath,
  canRegisterCurrent,
  onSave,
  onClear,
}: {
  startPath: StartPath | null;
  /** False while the explorer sits on the app grid — there is nothing to register. */
  canRegisterCurrent: boolean;
  onSave: () => void;
  onClear: () => void;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="size-8 shrink-0 p-0"
          aria-label="Settings"
          title="Settings"
        >
          <Settings2 className="size-4" strokeWidth={1.7} />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>How the iPhone explorer behaves on launch.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Startup folder</span>
          <p className="text-xs leading-relaxed text-muted-foreground">
            The explorer opens here right after pairing. Browse to a folder, then save it here;
            leave unset to start on the app grid.
          </p>
          <code className="rounded-md bg-muted px-2 py-1.5 text-xs [overflow-wrap:anywhere]">
            {formatStartPath(startPath)}
          </code>
          {!canRegisterCurrent ? (
            <p className="text-xs text-muted-foreground">
              Browse into an app or the media partition first to register it.
            </p>
          ) : null}
        </div>
        <DialogFooter>
          {startPath ? (
            <Button variant="outline" size="sm" onClick={onClear}>
              Clear
            </Button>
          ) : null}
          <Button size="sm" disabled={!canRegisterCurrent} onClick={onSave}>
            Use current folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
