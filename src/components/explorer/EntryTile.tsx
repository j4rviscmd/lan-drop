import { ArrowDownToLine, ChevronRight } from "lucide-react";

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
  onOpen: (entry: UsbEntry) => void;
}

/** Grid tile for one device entry. */
export function EntryTile({ entry, udid, path, app, rootRef, onOpen }: EntryTileProps) {
  const Icon = entry.is_dir ? ChevronRight : ArrowDownToLine;
  return (
    <button
      type="button"
      title={entry.name}
      aria-label={entry.name + (entry.is_dir ? ", folder" : `, ${fmtSize(entry.size)}`)}
      onClick={() => onOpen(entry)}
      className="group relative flex flex-col gap-1.5 rounded-lg border bg-card p-2 text-left transition-colors hover:border-ring hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Thumb
        udid={udid}
        kind={entry.is_dir ? "dir" : fileKind(entry.name)}
        path={entry.is_dir ? undefined : path}
        app={app}
        rootRef={rootRef}
        className={cn(
          "aspect-square place-self-stretch rounded-md bg-muted p-6",
          entry.is_dir ? "text-primary" : "text-muted-foreground",
        )}
      />
      <span className="line-clamp-2 min-h-[2.7em] overflow-hidden text-xs leading-[1.35] [overflow-wrap:anywhere]">
        {entry.name}
      </span>
      <span className="text-[11px] text-muted-foreground">
        {entry.is_dir ? "" : fmtSize(entry.size)}
      </span>
      <span className="absolute top-3 right-3 grid size-[26px] place-items-center rounded-md bg-background/75 opacity-0 transition-opacity group-hover:opacity-100">
        <Icon aria-hidden="true" className="size-3.5" />
      </span>
    </button>
  );
}
