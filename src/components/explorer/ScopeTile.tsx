import { ChevronRight } from "lucide-react";

import { cn } from "@lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui/tooltip";

import { Thumb } from "./Thumb";

interface ScopeTileProps {
  name: string;
  kind: "app" | "media";
  udid: string;
  noAccess: boolean;
  rootRef: React.RefObject<Element | null>;
  onOpen: () => void;
}

const NO_ACCESS_MSG = "doesn't allow file access — iOS only exposes file-sharing apps.";

/** Tile that switches the browse scope (an app container or the media partition). */
export function ScopeTile({ name, kind, udid, noAccess, rootRef, onOpen }: ScopeTileProps) {
  const tile = (
    <button
      type="button"
      title={name}
      aria-label={`${name}, folder`}
      onClick={onOpen}
      className={cn(
        "relative flex flex-col gap-1.5 rounded-lg border bg-card p-2 text-left",
        noAccess
          ? "cursor-not-allowed opacity-45"
          : "transition-colors hover:border-ring hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50",
      )}
    >
      <Thumb
        udid={udid}
        kind={kind}
        app={null}
        rootRef={rootRef}
        className="aspect-square place-self-stretch rounded-md bg-muted p-6 text-primary"
      />
      <span className="line-clamp-2 min-h-[2.7em] overflow-hidden text-xs leading-[1.35] [overflow-wrap:anywhere]">
        {name}
      </span>
      <span className="absolute top-3 right-3 grid size-[26px] place-items-center rounded-md bg-background/75">
        <ChevronRight aria-hidden="true" className="size-3.5" />
      </span>
    </button>
  );

  return noAccess ? (
    <Tooltip>
      <TooltipTrigger asChild>{tile}</TooltipTrigger>
      <TooltipContent>
        {name} {NO_ACCESS_MSG}
      </TooltipContent>
    </Tooltip>
  ) : (
    tile
  );
}
