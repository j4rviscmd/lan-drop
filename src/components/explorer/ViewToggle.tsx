import { LayoutGrid, List } from "lucide-react";

import { ToggleGroup, ToggleGroupItem } from "@ui/toggle-group";

import type { UsbView } from "@hooks/useUsbBrowser";

/** Grid/list toggle; the value persists to localStorage via the hook. */
export function ViewToggle({ view, onChange }: { view: UsbView; onChange: (v: UsbView) => void }) {
  return (
    <ToggleGroup
      type="single"
      value={view}
      onValueChange={(v) => {
        // Note: Radix single toggle-group emits "" when the active item is
        // re-clicked (deselect); ignore it so a view is always selected.
        if (v) onChange(v as UsbView);
      }}
      variant="outline"
      size="sm"
      className="shrink-0"
      aria-label="Explorer view"
    >
      <ToggleGroupItem value="grid" aria-label="Grid view" title="Grid view">
        <LayoutGrid className="size-4" strokeWidth={1.7} />
      </ToggleGroupItem>
      <ToggleGroupItem value="list" aria-label="List view" title="List view">
        <List className="size-4" strokeWidth={1.7} />
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
