import type { UsbEntry } from "@lib/types";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@ui/context-menu";
import { toast } from "sonner";

interface EntryMenuProps {
  entry: UsbEntry;
  onOpen: (entry: UsbEntry) => void;
  onPull: (entry: UsbEntry) => void;
  onDelete: (entry: UsbEntry) => void;
  children: React.ReactNode;
}

/** Right-click menu shared by the tile and row cards. Name copy is local
 * (clipboard + toast); open/pull/delete route to useUsbBrowser callbacks. */
export function EntryMenu({ entry, onOpen, onPull, onDelete, children }: EntryMenuProps) {
  const copyName = async () => {
    try {
      await navigator.clipboard.writeText(entry.name);
      toast.success(`Copied "${entry.name}"`);
    } catch (e) {
      toast.error(`Copy failed: ${e}`);
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {entry.is_dir ? (
          <ContextMenuItem onSelect={() => onOpen(entry)}>Open</ContextMenuItem>
        ) : null}
        <ContextMenuItem onSelect={() => onPull(entry)}>
          {entry.is_dir ? "Download folder" : "Save to PC"}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void copyName()}>
          {entry.is_dir ? "Copy folder name" : "Copy file name"}
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onSelect={() => onDelete(entry)}>
          {entry.is_dir ? "Delete folder" : "Delete from device"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
