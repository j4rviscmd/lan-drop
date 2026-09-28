import type { ServerInfo } from "@lib/types";

import { ExplorerCard } from "./ExplorerCard";
import { StorageCard } from "./StorageCard";
import { TransfersCard } from "./TransfersCard";

/**
 * Two-column layout: cards left, explorer owning the right side.
 * The page never scrolls at ≥860px — the left column and the file list
 * scroll internally.
 */
export function Shell({ info }: { info: ServerInfo }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-[640px] flex-col p-5 pb-8 min-[860px]:h-dvh min-[860px]:max-w-none min-[860px]:overflow-hidden min-[860px]:pb-4">
      <header className="shrink-0">
        <h1 className="m-0 text-[22px] font-semibold">
          lan<span className="text-primary">·</span>drop
        </h1>
        <p className="mt-1 mb-0 text-[13px] text-emerald-400">
          Server running · port {info.port}
        </p>
      </header>
      <div className="mt-4 grid flex-1 gap-3.5 min-[860px]:grid-cols-[400px_minmax(0,1fr)] min-[860px]:min-h-0">
        <div className="flex flex-col gap-3.5 min-[860px]:min-h-0 min-[860px]:overflow-y-auto">
          <StorageCard info={info} />
          <TransfersCard />
        </div>
        <ExplorerCard uploadDir={info.upload_dir} />
      </div>
    </div>
  );
}
