import type { UsbBrowser } from "@hooks/useUsbBrowser";
import { cn } from "@lib/utils";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Badge } from "@ui/badge";
import { Button } from "@ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@ui/card";
import { Input } from "@ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ui/select";
import { Skeleton } from "@ui/skeleton";
import { ArrowDownToLine, Search, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Breadcrumbs } from "./explorer/Breadcrumbs";
import { ScopeTile } from "./explorer/ScopeTile";
import { SettingsDialog } from "./explorer/SettingsDialog";
import { ViewToggle } from "./explorer/ViewToggle";
import { VirtualEntryList } from "./explorer/VirtualEntryList";

const TILE_GRID = "grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2.5 pt-1";

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-[13px] text-muted-foreground">{children}</p>;
}

export function ExplorerCard({ usb }: { usb: UsbBrowser }) {
  const [query, setQuery] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  // Content width of the list scroller — drives the virtualized grid's
  // column count. Observed here (not in VirtualEntryList) so it is settled
  // before the first entries arrive. Why usb.paired dep: the scroller only
  // mounts once pairing succeeds — a [] dep would run before it exists and
  // never observe it.
  const [listWidth, setListWidth] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: usb.paired is an intentional re-run trigger — see the comment above.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => {
      for (const e of es) setListWidth(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [usb.paired]);

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
  // typed for one folder never leaks into the next view — and the virtualized
  // list restarts at the top like any file browser (stale scroll offsets
  // would land mid-list on estimates).
  // biome-ignore lint/correctness/useExhaustiveDependencies: usb.scope/usb.cwd are intentional re-run triggers — see the comment above.
  useEffect(() => {
    setQuery("");
    listRef.current?.scrollTo({ top: 0 });
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
  // Selection covers files and folders alike (folders pull recursively).
  const selectable = filteredEntries ?? [];
  const selectedCount = selectable.filter((e) => usb.selectedHere.has(e.name)).length;
  const allSelected = selectable.length > 0 && selectedCount === selectable.length;

  const entriesEmpty = filteredEntries?.length === 0;
  const appsEmpty = filteredApps?.length === 0;

  let listing: React.ReactNode = null;
  if (usb.loading) {
    listing = (
      <div className={TILE_GRID}>
        {Array.from({ length: 8 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed 8-slot loading skeleton; never reorders.
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
      listing = (
        <VirtualEntryList
          entries={filteredEntries ?? []}
          view={usb.view}
          scrollRef={listRef}
          width={listWidth}
          udid={usb.udid ?? ""}
          pathFor={usb.pathFor}
          app={usb.scope?.type === "app" ? usb.scope.id : null}
          selected={usb.selectedHere}
          onOpen={usb.openEntry}
          onToggle={usb.toggleSelect}
          onPull={usb.pull}
          onDelete={usb.deleteEntry}
        />
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
          {/* Why: Pair is unnecessary once paired; refresh() -> checkPaired() re-detects unpaired devices and re-shows this button. */}
          {!usb.paired && (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => void usb.pair()}
            >
              Pair
            </Button>
          )}
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
              <div className="flex shrink-0 items-center gap-2">
                <ViewToggle view={usb.view} onChange={usb.setView} />
                <SettingsDialog
                  startPath={usb.startPath}
                  canRegisterCurrent={usb.scope !== null}
                  onSave={usb.saveStartPath}
                  onClear={usb.clearStartPath}
                />
              </div>
            </div>

            <div className="mt-2 flex items-center gap-2">
              {usb.scope !== null ? (
                // Fixed-width slot keeps the buttons/filter anchored regardless
                // of counter digits or visibility. ponytail: min-w-32 covers up
                // to "999/999 selected"; 4+ digit counts still widen slightly.
                <div className="flex min-w-32 shrink-0 items-center gap-2">
                  {!usb.loading && selectable.length > 0 ? (
                    <>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = selectedCount > 0 && !allSelected;
                        }}
                        onChange={(e) => usb.toggleAll(selectable, e.target.checked)}
                        aria-label="Select all"
                        className="size-3.5 shrink-0 cursor-pointer accent-primary"
                      />
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {selectedCount}/{selectable.length} selected here
                      </span>
                    </>
                  ) : null}
                </div>
              ) : null}
              <div
                className={cn("shrink-0 gap-2", usb.scope !== null ? "grid grid-cols-2" : "flex")}
              >
                {/* Why: gate on the whole basket, not this folder's count —
                    ticked items can live in other folders. */}
                {usb.scope !== null ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled={usb.selected.size === 0}
                    onClick={() => void usb.pullSelected()}
                  >
                    <ArrowDownToLine className="size-3.5 shrink-0" />
                    {usb.selected.size > 0 ? `Pull ${usb.selected.size} to PC` : "Pull to PC"}
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
              allow file access). "Media partition" holds DCIM photos and recordings. Tick files or
              folders — they gather in the "Selected" list at the left, across folders — then press
              "Pull to PC" to download them into the upload folder shown under Storage. Right-click
              an entry to save, copy its name, or delete it on the device. Files sent while inside
              an app land in its Documents.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
