import { Card, CardContent, CardHeader, CardTitle } from "@ui/card";

import type { ServerInfo } from "@lib/types";

export function StorageCard({ info }: { info: ServerInfo }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[13px] tracking-[0.06em] text-muted-foreground uppercase">
          Storage
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <div className="flex justify-between gap-3 text-[13px]">
          <span className="text-muted-foreground">Uploads arrive in</span>
          <code className="text-xs [overflow-wrap:anywhere] text-right">{info.upload_dir}</code>
        </div>
      </CardContent>
    </Card>
  );
}
