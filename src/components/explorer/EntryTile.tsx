import { ChevronRight } from "lucide-react";

import { fileKind, fmtSize } from "@lib/format";
import type { UsbEntry } from "@lib/types";
import { cn } from "@lib/utils";

import { Thumb } from "./Thumb";

interface EntryTileProps {
  entry: UsbEntry;
  udid: string;
  path: string;
  app: string | null;
  rootRef: React.RefObject<Element | null>;
  selected: boolean;
  onOpen: (entry: UsbEntry) => void;
  onToggle: (entry: UsbEntry) => void;
}

/** Grid tile for one device entry. Folders open; files tick for a bulk pull. */
export function EntryTile({
  entry,
  udid,
  path,
  app,
  rootRef,
  selected,
  onOpen,
  onToggle,
}: EntryTileProps) {
  if (!entry.is_dir) {
    // Why a label: the whole tile toggles the checkbox — one click target,
    // native keyboard support, no nested-interactive markup.
    return (
      <label
        title={entry.name}
        className={cn(
          "group relative flex cursor-pointer flex-col gap-1.5 rounded-lg border bg-card p-2 text-left transition-colors hover:border-ring has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
          selected && "border-ring bg-accent/50",
        )}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(entry)}
          aria-label={`Select ${entry.name} (${fmtSize(entry.size)})`}
          className="absolute top-2 left-2 z-10 size-4 cursor-pointer accent-primary"
        />
        <Thumb
          udid={udid}
          kind={fileKind(entry.name)}
          path={path}
          app={app}
          rootRef={rootRef}
          className="aspect-square place-self-stretch rounded-md bg-muted p-6 text-muted-foreground"
        />
        <span className="line-clamp-2 min-h-[2.7em] overflow-hidden text-xs leading-[1.35] [overflow-wrap:anywhere]">
          {entry.name}
        </span>
        <span className="text-[11px] text-muted-foreground">{fmtSize(entry.size)}</span>
      </label>
    );
  }
  return (
    <button
      type="button"
      title={entry.name}
      aria-label={`${entry.name}, folder`}
      onClick={() => onOpen(entry)}
      className="group relative flex flex-col gap-1.5 rounded-lg border bg-card p-2 text-left transition-colors hover:border-ring hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Thumb
        udid={udid}
        kind="dir"
        app={app}
        rootRef={rootRef}
        className="aspect-square place-self-stretch rounded-md bg-muted p-6 text-primary"
      />
      <span className="line-clamp-2 min-h-[2.7em] overflow-hidden text-xs leading-[1.35] [overflow-wrap:anywhere]">
        {entry.name}
      </span>
      <span className="absolute top-3 right-3 grid size-[26px] place-items-center rounded-md bg-background/75 opacity-0 transition-opacity group-hover:opacity-100">
        <ChevronRight aria-hidden="true" className="size-3.5" />
      </span>
    </button>
  );
}
