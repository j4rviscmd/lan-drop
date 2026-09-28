import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { subscribeUploads } from "@lib/sse";
import type { Transfer, TransferDirection } from "@lib/types";

interface TransfersApi {
  transfers: Transfer[];
  /** Create an optimistic row (pull/push start before any SSE data). */
  track: (file: string, direction: TransferDirection) => void;
}

const TransfersContext = createContext<TransfersApi | null>(null);

export function TransfersProvider({
  loopbackPort,
  children,
}: {
  loopbackPort: number;
  children: ReactNode;
}) {
  // Insertion-ordered map keyed by file name — mirrors the old DOM
  // "prepend once, then update in place" behavior (newest first via reverse).
  const [map, setMap] = useState<Map<string, Transfer>>(() => new Map());

  const upsert = useCallback(
    (file: string, direction: TransferDirection, patch: Partial<Transfer>) => {
      setMap((prev) => {
        const next = new Map(prev);
        const cur = next.get(file) ?? {
          file,
          direction,
          received: 0,
          total: 0,
          done: false,
          size: 0,
        };
        next.set(file, { ...cur, ...patch });
        return next;
      });
    },
    [],
  );

  const track = useCallback(
    (file: string, direction: TransferDirection) => upsert(file, direction, {}),
    [upsert],
  );

  // SSE: phone → PC uploads over the Wi-Fi/LAN browser path.
  useEffect(() => {
    return subscribeUploads(loopbackPort, {
      progress: (e) => upsert(e.file, "in", { received: e.received, total: e.total }),
      done: (e) => {
        // Why: "done" can arrive without a final progress event — backfill
        // total/received from the final size so the bar renders full (vanilla-JS parity).
        upsert(e.file, "in", { done: true, size: e.size, total: e.size, received: e.size });
        // USB pulls are PC-initiated — useUsbBrowser already toasts
        // "Saved to …", so skip the duplicate "Received" toast here.
        if (!e.local) toast.success(`Received ${e.file}`);
      },
    });
  }, [loopbackPort, upsert]);

  const transfers = useMemo(() => [...map.values()].reverse(), [map]);

  const value = useMemo(() => ({ transfers, track }), [transfers, track]);

  return <TransfersContext.Provider value={value}>{children}</TransfersContext.Provider>;
}

export function useTransfers(): TransfersApi {
  const ctx = useContext(TransfersContext);
  if (!ctx) throw new Error("useTransfers must be used within TransfersProvider");
  return ctx;
}
