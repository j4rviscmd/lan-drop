import { useTransfers } from "@hooks/useTransfers";
import { useUsbBrowser } from "@hooks/useUsbBrowser";
import type { ServerInfo } from "@lib/types";

import { ExplorerCard } from "./ExplorerCard";
import { SelectionCard } from "./SelectionCard";
import { StorageCard } from "./StorageCard";
import { TransfersCard } from "./TransfersCard";

/**
 * Two-column layout: cards left, explorer owning the right side.
 * The page never scrolls at ≥860px — the left column and the file list
 * scroll internally.
 *
 * Shell owns the USB browser so the left-rail SelectionCard and the
 * ExplorerCard share one ticked basket.
 */
export function Shell({
  info,
  onUploadDirChanged,
}: {
  info: ServerInfo;
  onUploadDirChanged: () => void;
}) {
  const { track } = useTransfers();
  const usb = useUsbBrowser(info.upload_dir, track);

  return (
    <div className="mx-auto flex min-h-dvh max-w-[640px] flex-col p-5 pb-8 min-[860px]:h-dvh min-[860px]:max-w-none min-[860px]:overflow-hidden min-[860px]:pb-4">
      <header className="shrink-0">
        <h1 className="m-0 text-[22px] font-semibold">
          lan<span className="text-primary">·</span>drop
        </h1>
      </header>
      <div className="mt-4 grid flex-1 gap-3.5 min-[860px]:grid-cols-[400px_minmax(0,1fr)] min-[860px]:min-h-0">
        <div className="flex flex-col gap-3.5 min-[860px]:min-h-0 min-[860px]:overflow-y-auto">
          <StorageCard info={info} onUploadDirChanged={onUploadDirChanged} />
          {usb.selected.size > 0 ? (
            <SelectionCard
              selection={usb.selected}
              onRemove={usb.removeSelected}
              onClear={usb.clearSelection}
              onDelete={() => void usb.deleteSelected()}
            />
          ) : null}
          <TransfersCard />
        </div>
        <ExplorerCard usb={usb} />
      </div>
    </div>
  );
}
