import { memo } from "react";
import { ChevronRight } from "lucide-react";

import { fileKind, fmtSize } from "@lib/format";
import type { UsbEntry } from "@lib/types";
import { cn } from "@lib/utils";

import { EntryMenu } from "./EntryMenu";
import { Thumb } from "./Thumb";

interface EntryRowProps {
  entry: UsbEntry;
  udid: string;
  path: string;
  app: string | null;
  rootRef: React.RefObject<Element | null>;
  selected: boolean;
  onOpen: (entry: UsbEntry) => void;
  onToggle: (entry: UsbEntry) => void;
  onPull: (entry: UsbEntry) => void;
  onDelete: (entry: UsbEntry) => void;
}

/** List row for one device entry. Folders open and tick; files tick for a
 * bulk pull. memo: a selection toggle re-renders only the
 * clicked row, not the whole directory listing (entry/handlers stay
 * referentially stable). */
export const EntryRow = memo(function EntryRow({
  entry,
  udid,
  path,
  app,
  rootRef,
  selected,
  onOpen,
  onToggle,
  onPull,
  onDelete,
}: EntryRowProps) {
  if (!entry.is_dir) {
    // Why a label: the whole row toggles the checkbox — one click target,
    // native keyboard support, no nested-interactive markup.
    return (
      <EntryMenu entry={entry} onOpen={onOpen} onPull={onPull} onDelete={onDelete}>
        <label
          title={entry.name}
          className={cn(
            "flex w-full cursor-pointer items-center gap-2.5 rounded-md border-b px-1 py-2 text-left transition-colors hover:bg-accent/50 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
            selected && "bg-accent/50",
          )}
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggle(entry)}
            aria-label={`Select ${entry.name} (${fmtSize(entry.size)})`}
            className="size-4 shrink-0 cursor-pointer accent-primary"
          />
          <Thumb
            udid={udid}
            kind={fileKind(entry.name)}
            path={path}
            app={app}
            rootRef={rootRef}
            className="size-[22px] rounded-sm text-muted-foreground"
          />
          <span className="min-w-0 flex-1 truncate text-sm">{entry.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {fmtSize(entry.size)}
          </span>
        </label>
      </EntryMenu>
    );
  }
  // Why checkbox outside the button: the row body is the open button — the
  // checkbox leads as a sibling instead of nesting interactives.
  return (
    <EntryMenu entry={entry} onOpen={onOpen} onPull={onPull} onDelete={onDelete}>
      <div
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md border-b px-1 py-2 text-left transition-colors hover:bg-accent/50",
          selected && "bg-accent/50",
        )}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(entry)}
          aria-label={`Select ${entry.name} (folder)`}
          className="size-4 shrink-0 cursor-pointer accent-primary"
        />
        <button
          type="button"
          title={entry.name}
          aria-label={`${entry.name}, folder`}
          onClick={() => onOpen(entry)}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Thumb
            udid={udid}
            kind="dir"
            app={app}
            rootRef={rootRef}
            className="size-[22px] rounded-sm text-primary"
          />
          <span className="min-w-0 flex-1 truncate text-sm">{entry.name}</span>
          <span className="grid shrink-0 place-items-center">
            <ChevronRight aria-hidden="true" className="size-4" />
          </span>
        </button>
      </div>
    </EntryMenu>
  );
});
