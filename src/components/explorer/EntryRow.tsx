import { ArrowDownToLine, ChevronRight } from "lucide-react";

import { fileKind, fmtSize } from "@lib/format";
import type { UsbEntry } from "@lib/types";

import { Thumb } from "./Thumb";

interface EntryRowProps {
  entry: UsbEntry;
  udid: string;
  path: string;
  app: string | null;
  rootRef: React.RefObject<Element | null>;
  onOpen: (entry: UsbEntry) => void;
}

/** List row for one device entry. */
export function EntryRow({ entry, udid, path, app, rootRef, onOpen }: EntryRowProps) {
  const Icon = entry.is_dir ? ChevronRight : ArrowDownToLine;
  return (
    <button
      type="button"
      title={entry.name}
      aria-label={entry.name + (entry.is_dir ? ", folder" : `, ${fmtSize(entry.size)}`)}
      onClick={() => onOpen(entry)}
      className="flex w-full items-center gap-2.5 rounded-md border-b px-1 py-2 text-left transition-colors hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Thumb
        udid={udid}
        kind={entry.is_dir ? "dir" : fileKind(entry.name)}
        path={entry.is_dir ? undefined : path}
        app={app}
        rootRef={rootRef}
        className={`size-[22px] rounded-sm ${entry.is_dir ? "text-primary" : "text-muted-foreground"}`}
      />
      <span className="min-w-0 flex-1 truncate text-sm">{entry.name}</span>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {entry.is_dir ? "" : fmtSize(entry.size)}
      </span>
      <span className="grid shrink-0 place-items-center">
        <Icon aria-hidden="true" className="size-4" />
      </span>
    </button>
  );
}
