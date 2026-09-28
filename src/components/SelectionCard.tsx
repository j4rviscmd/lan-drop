import { pathOf } from "@hooks/useUsbBrowser";
import { fmtSize } from "@lib/format";
import type { SelectedEntry } from "@lib/types";
import { Button } from "@ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ui/dropdown-menu";
import { File, Folder, ListX, MoreHorizontal, Trash2, X } from "lucide-react";

/** Where a ticked item lives — "AppName/DCIM/100APPLE" style hint. */
function locOf(it: SelectedEntry): string {
  const root = it.scope.type === "app" ? it.scope.name : "Media";
  return root + (it.cwd.length ? `/${it.cwd.join("/")}` : "");
}

interface SelectionCardProps {
  selection: ReadonlyMap<string, SelectedEntry>;
  onRemove: (key: string) => void;
  onClear: () => void;
  onDelete: () => void;
}

/** Left-rail list of every ticked device item, across folders — makes the
 *  bulk Pull/Delete targets visible instead of a bare "1/n" counter.
 *  Rendered only while something is ticked. */
export function SelectionCard({ selection, onRemove, onClear, onDelete }: SelectionCardProps) {
  return (
    // Why: at >=860px, Selected and Transfers split the left rail below Storage 1:1; the list scrolls internally.
    <Card className="min-[860px]:min-h-0 min-[860px]:flex-1">
      <CardHeader>
        <CardTitle className="text-[13px] tracking-[0.06em] text-muted-foreground uppercase">
          Selected <span className="tabular-nums">· {selection.size}</span>
        </CardTitle>
        <CardAction>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Selected items actions"
                className="text-muted-foreground"
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem variant="destructive" onSelect={() => onDelete()}>
                <Trash2 />
                Delete {selection.size} from device…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onClear()}>
                <ListX />
                Clear list
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 min-[860px]:min-h-0 min-[860px]:flex-1">
        <div className="flex max-h-44 flex-col gap-1 overflow-y-auto min-[860px]:max-h-none min-[860px]:flex-1">
          {[...selection].map(([key, it]) => (
            <div key={key} className="flex items-center gap-2 text-[13px]">
              {it.is_dir ? (
                <Folder aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <File aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate" title={pathOf(it.scope, it.cwd, it.name)}>
                  {it.name}
                </span>
                <span className="block truncate text-xs leading-4 text-muted-foreground">
                  {locOf(it)}
                </span>
              </span>
              {!it.is_dir ? (
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {fmtSize(it.size)}
                </span>
              ) : null}
              <button
                type="button"
                aria-label={`Remove ${it.name} from selection`}
                onClick={() => onRemove(key)}
                className="shrink-0 cursor-pointer rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
