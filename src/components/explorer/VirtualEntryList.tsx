import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useState } from "react";

import type { UsbView } from "@hooks/useUsbBrowser";
import type { UsbEntry } from "@lib/types";

import { EntryRow } from "./EntryRow";
import { EntryTile } from "./EntryTile";

// Mirror of the TILE_GRID constants in ExplorerCard (gap-2.5, min 104px tiles)
// so the virtualized rows reproduce the auto-fill grid exactly.
const GAP = 10;
const MIN_TILE = 104;

interface VirtualEntryListProps {
  entries: UsbEntry[];
  view: UsbView;
  /** Scroll container (owns the viewport height); also the Thumb IO root. */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** Content-box width of the scroll container, 0 until measured. */
  width: number;
  udid: string;
  app: string | null;
  selected: ReadonlySet<string>;
  pathFor: (name: string) => string;
  onOpen: (entry: UsbEntry) => void;
  onToggle: (entry: UsbEntry) => void;
  onPull: (entry: UsbEntry) => void;
  onDelete: (entry: UsbEntry) => void;
}

/**
 * Windowed rendering of a directory listing. Directories with 1000+ entries
 * re-render only the ~30 visible items on a selection toggle instead of all
 * of them, and the DOM holds only the near-viewport rows.
 *
 * Why rows-of-N for the grid: one virtualizer serves both views — list rows
 * are 1-column chunks, grid rows are N tiles — so tiles keep their stable
 * props and the memo bailout from ExplorerCard re-renders.
 *
 * Why the scroll element resolves through state: the scroller lives in the
 * parent, and a child's layout effects run before the parent's ref attaches —
 * the virtualizer would see null on every mount commit and never subscribe.
 * A passive effect runs after all refs settled, and the state flip re-runs
 * the virtualizer's update with the real element.
 */
export function VirtualEntryList({
  entries,
  view,
  scrollRef,
  width,
  udid,
  app,
  selected,
  pathFor,
  onOpen,
  onToggle,
  onPull,
  onDelete,
}: VirtualEntryListProps) {
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    setScrollEl(scrollRef.current);
  }, [scrollRef]);

  // Why width guard: the auto-fill column count must match the CSS grid the
  // tiles were sized for; until the ResizeObserver reports, render nothing
  // rather than a wrong 1-column flash.
  const cols = view === "list" ? 1 : Math.max(1, Math.floor((width + GAP) / (MIN_TILE + GAP)));

  const rows = useMemo(() => {
    const out: UsbEntry[][] = [];
    for (let i = 0; i < entries.length; i += cols) out.push(entries.slice(i, i + cols));
    return out;
  }, [entries, cols]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollEl,
    // Rough guesses only — measureElement corrects on first paint (list rows
    // are uniform; grid row height tracks the tile width, so no fixed math).
    estimateSize: () => (view === "list" ? 40 : MIN_TILE + 76),
    overscan: view === "list" ? 8 : 4,
  });

  if (view === "grid" && width === 0) return null;

  return (
    <div className="pt-1">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((v) => (
          <div
            key={v.key}
            data-index={v.index}
            ref={virtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${v.start}px)`,
            }}
          >
            <div
              className={view === "grid" ? "grid gap-2.5" : undefined}
              style={view === "grid" ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined}
            >
              {rows[v.index]?.map((en) =>
                view === "grid" ? (
                  <EntryTile
                    key={en.name}
                    entry={en}
                    udid={udid}
                    path={pathFor(en.name)}
                    app={app}
                    rootRef={scrollRef}
                    selected={selected.has(en.name)}
                    onOpen={onOpen}
                    onToggle={onToggle}
                    onPull={onPull}
                    onDelete={onDelete}
                  />
                ) : (
                  <EntryRow
                    key={en.name}
                    entry={en}
                    udid={udid}
                    path={pathFor(en.name)}
                    app={app}
                    rootRef={scrollRef}
                    selected={selected.has(en.name)}
                    onOpen={onOpen}
                    onToggle={onToggle}
                    onPull={onPull}
                    onDelete={onDelete}
                  />
                ),
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
