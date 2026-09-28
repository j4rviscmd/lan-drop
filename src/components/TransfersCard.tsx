import { useTransfers } from "@hooks/useTransfers";
import { fmtSize } from "@lib/format";
import { cn } from "@lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@ui/card";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@ui/empty";
import { Progress } from "@ui/progress";
import { ArrowDownToLine, ArrowUpFromLine, Inbox } from "lucide-react";

export function TransfersCard() {
  const { transfers } = useTransfers();

  return (
    // Why: at >=860px, Transfers and Selected split the left rail below Storage 1:1; the list scrolls internally.
    <Card className="min-[860px]:min-h-0 min-[860px]:flex-1">
      <CardHeader>
        <CardTitle className="text-[13px] tracking-[0.06em] text-muted-foreground uppercase">
          Transfers
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col min-[860px]:min-h-0 min-[860px]:flex-1">
        {transfers.length === 0 ? (
          <Empty className="gap-2 rounded-none border-0 p-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Inbox />
              </EmptyMedia>
              <EmptyTitle className="text-sm font-normal">No transfers yet</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-2.5 min-[860px]:flex-1 min-[860px]:overflow-y-auto">
            {transfers.map((t) => {
              // Why: total=0 (size unknown yet) shows "…" until the first
              // progress event; the 100 clamp guards rounding (vanilla-JS parity).
              const pct = t.total ? Math.min(100, Math.round((t.received / t.total) * 100)) : 0;
              const Icon = t.direction === "in" ? ArrowDownToLine : ArrowUpFromLine;
              return (
                <div key={t.file}>
                  <div className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Icon
                        aria-hidden="true"
                        className="size-3.5 shrink-0 text-muted-foreground"
                      />
                      <span className="truncate" title={t.file}>
                        {t.file}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {t.done ? fmtSize(t.size) : t.total ? `${pct}%` : "…"}
                    </span>
                  </div>
                  <Progress
                    value={t.done ? 100 : pct}
                    className={cn(
                      "mt-1 h-1.5",
                      // Why: green "done" bar — parity with the vanilla #4aba8c.
                      t.done && "[&_[data-slot=progress-indicator]]:bg-emerald-600",
                    )}
                    aria-label={`${t.file} progress`}
                  />
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
