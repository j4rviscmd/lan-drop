import { ArrowDownToLine, Search, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

import { useUsbBrowser } from "@hooks/useUsbBrowser";
import { useTransfers } from "@hooks/useTransfers";
import { cn } from "@lib/utils";
import { Badge } from "@ui/badge";
import { Button } from "@ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@ui/card";
import { Input } from "@ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ui/select";
import { Skeleton } from "@ui/skeleton";

import { Breadcrumbs } from "./explorer/Breadcrumbs";
import { EntryRow } from "./explorer/EntryRow";
import { EntryTile } from "./explorer/EntryTile";
import { ScopeTile } from "./explorer/ScopeTile";
import { ViewToggle } from "./explorer/ViewToggle";

const TILE_GRID = "grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2.5 pt-1";

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-[13px] text-muted-foreground">{children}</p>;
}

export function ExplorerCard({ uploadDir }: { uploadDir: string }) {
  const { track } = useTransfers();
  const usb = useUsbBrowser(uploadDir, track);
  const [query, setQuery] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Drag & drop push: the webview hands us absolute paths, which go straight
  // into usb_push — no file dialog. The Send button stays as the
  // keyboard/click alternative.
  const { pushPath } = usb;
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      const p = event.payload;
      if (p.type === "enter" || p.type === "over") setDragActive(true);
      else setDragActive(false); // drop or leave
      if (p.type === "drop") {
        for (const path of p.paths) void pushPath(path);
      }
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, [pushPath]);

  // Why: every navigation updates scope or cwd in useUsbBrowser, so a query
  // typed for one folder never leaks into the next view.
  useEffect(() => {
    setQuery("");
  }, [usb.scope, usb.cwd]);

  const device = usb.devices.find((d) => d.udid === usb.udid);
  // usbmuxd reports "Network" for Wi-Fi Sync devices, "Usb" otherwise.
  const isNetwork = device?.connection.toLowerCase().includes("network") ?? false;

  const q = query.trim().toLowerCase();
  const filteredEntries = useMemo(
    () => usb.entries?.filter((e) => e.name.toLowerCase().includes(q)) ?? null,
    [usb.entries, q],
  );
  const filteredApps = useMemo(
    () => usb.apps?.filter((a) => a.name.toLowerCase().includes(q)) ?? null,
    [usb.apps, q],
  );
  const fileEntries = useMemo(
    () => filteredEntries?.filter((e) => !e.is_dir) ?? [],
    [filteredEntries],
  );
  const selectedCount = fileEntries.filter((e) => usb.selected.has(e.name)).length;
  const allSelected = fileEntries.length > 0 && selectedCount === fileEntries.length;

  const entriesEmpty = filteredEntries?.length === 0;
  const appsEmpty = filteredApps?.length === 0;

  let listing: React.ReactNode = null;
  if (usb.loading) {
    listing = (
      <div className={TILE_GRID}>
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="aspect-[1/1.35] rounded-lg" />
        ))}
      </div>
    );
  } else if (usb.scope === null) {
    if (usb.apps !== null) {
      if (appsEmpty && q) {
        listing = <EmptyNote>No matches</EmptyNote>;
      } else if (appsEmpty) {
        listing = <EmptyNote>No user-installed apps</EmptyNote>;
      } else {
        listing = (
          <div className={TILE_GRID}>
            {filteredApps?.map((a) => (
              <ScopeTile
                key={a.bundle_id}
                name={a.name}
                kind="app"
                udid={usb.udid ?? ""}
                noAccess={usb.noAccess.has(a.bundle_id)}
                rootRef={listRef}
                onOpen={() => usb.openApp(a)}
              />
            ))}
            {/* Why: apps are the initial view per design; the media
                partition is the fallback/legacy target, so its tile goes last. */}
            <ScopeTile
              name="Media partition"
              kind="media"
              udid={usb.udid ?? ""}
              noAccess={false}
              rootRef={listRef}
              onOpen={usb.openMedia}
            />
          </div>
        );
      }
    }
  } else {
    if (entriesEmpty && q) {
      listing = <EmptyNote>No matches</EmptyNote>;
    } else if (entriesEmpty) {
      listing = <EmptyNote>Nothing here</EmptyNote>;
    } else {
      const Entry = usb.view === "grid" ? EntryTile : EntryRow;
      listing = (
        <div className={usb.view === "grid" ? TILE_GRID : "pt-1"}>
          {filteredEntries?.map((en) => (
            <Entry
              key={en.name}
              entry={en}
              udid={usb.udid ?? ""}
              path={usb.pathFor(en.name)}
              app={usb.scope?.type === "app" ? usb.scope.id : null}
              rootRef={listRef}
              selected={usb.selected.has(en.name)}
              onOpen={usb.openEntry}
              onToggle={usb.toggleSelect}
            />
          ))}
        </div>
      );
    }
  }

  return (
    <Card className="flex min-h-0 flex-col min-[860px]:flex-1">
      <CardHeader>
        <CardTitle className="text-[13px] tracking-[0.06em] text-muted-foreground uppercase">
          iPhone via USB cable
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <Select value={usb.udid ?? undefined} onValueChange={usb.selectDevice}>
            <SelectTrigger size="sm" className="min-w-0 flex-1">
              <SelectValue placeholder="No device" />
            </SelectTrigger>
            <SelectContent>
              {usb.devices.map((d) => (
                <SelectItem key={d.udid} value={d.udid}>
                  {d.udid} ({d.connection})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => void usb.refresh()}
          >
            Refresh
          </Button>
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => void usb.pair()}>
            Pair
          </Button>
        </div>

        <p className="mt-2 flex min-h-4 items-start gap-1.5 text-xs leading-4 text-muted-foreground [overflow-wrap:anywhere]">
          {usb.paired && device ? (
            <Badge
              variant={isNetwork ? "secondary" : "outline"}
              className="mt-px shrink-0 px-1.5 text-[10px]"
            >
              {isNetwork ? "Wi-Fi" : "USB"}
            </Badge>
          ) : null}
          {usb.status}
        </p>

        {usb.paired ? (
          <div
            className={cn(
              "relative mt-1.5 flex min-h-0 flex-1 flex-col rounded-lg",
              dragActive && "ring-2 ring-primary ring-offset-4 ring-offset-card",
            )}
          >
            {dragActive ? (
              <div className="absolute inset-x-0 top-1/2 z-10 mx-auto w-fit -translate-y-1/2 rounded-md bg-background/90 px-3 py-1.5 text-[13px] font-medium shadow-sm">
                Drop files to send to the phone
              </div>
            ) : null}

            <div className="flex items-start justify-between gap-2">
              <Breadcrumbs scope={usb.scope} cwd={usb.cwd} onNavigate={usb.navigate} />
              <ViewToggle view={usb.view} onChange={usb.setView} />
            </div>

            <div className="mt-2 flex items-center gap-2">
              {!usb.loading && usb.scope !== null && fileEntries.length > 0 ? (
                <>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = selectedCount > 0 && !allSelected;
                    }}
                    onChange={(e) =>
                      usb.setSelected(
                        e.target.checked ? new Set(fileEntries.map((f) => f.name)) : new Set(),
                      )
                    }
                    aria-label="Select all files"
                    className="size-3.5 shrink-0 cursor-pointer accent-primary"
                  />
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {selectedCount}/{fileEntries.length} selected
                  </span>
                </>
              ) : null}
              <div
                className={cn(
                  "shrink-0 gap-2",
                  usb.scope !== null ? "grid grid-cols-2" : "flex",
                )}
              >
                {usb.scope !== null ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled={selectedCount === 0}
                    onClick={() => void usb.pullSelected()}
                  >
                    <ArrowDownToLine className="size-3.5 shrink-0" />
                    Pull to PC
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => void usb.pickAndPush()}
                >
                  <Upload className="size-3.5 shrink-0" />
                  Send a file to the phone
                </Button>
              </div>
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter…"
                  aria-label="Filter files and apps"
                  className="h-8 pl-8 text-[13px]"
                />
              </div>
            </div>

            <div
              ref={listRef}
              // Why: below 860px the page scrolls, so the list caps at 340px;
              // at ≥860px the page never scrolls and the list flexes to fill.
              className="mt-2 max-h-[340px] min-h-0 flex-1 overflow-y-auto overscroll-contain min-[860px]:max-h-none"
            >
              {listing}
            </div>

            <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
              Initial view lists your installed apps — tap one to browse its files (the app must
              allow file access). "Media partition" holds DCIM photos and recordings. Tick files,
              then press "Pull to PC" to download them into the PC's Downloads\lan-drop. Files
              sent while inside an app land in its Documents.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
