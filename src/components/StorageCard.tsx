import { FolderOpen } from "lucide-react";
import { toast } from "sonner";

import { api } from "@lib/api";
import type { ServerInfo } from "@lib/types";
import { Button } from "@ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@ui/card";

export function StorageCard({
  info,
  onUploadDirChanged,
}: {
  info: ServerInfo;
  onUploadDirChanged: () => void;
}) {
  const changeUploadDir = async () => {
    const path = await api.pickFolder();
    if (!path) return;
    try {
      const dir = await api.setUploadDir(path);
      toast.success(`Uploads now arrive in ${dir}`);
      onUploadDirChanged();
    } catch (e) {
      toast.error(String(e));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[13px] tracking-[0.06em] text-muted-foreground uppercase">
          Storage
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3 text-[13px]">
          <span className="text-muted-foreground">Uploads arrive in</span>
          <span className="flex min-w-0 items-center justify-end gap-1.5">
            <code className="text-xs [overflow-wrap:anywhere] text-right">{info.upload_dir}</code>
            <Button
              variant="outline"
              size="sm"
              className="size-8 shrink-0 p-0"
              aria-label="Change upload folder"
              title="Change upload folder"
              onClick={changeUploadDir}
            >
              <FolderOpen className="size-4" strokeWidth={1.7} />
            </Button>
          </span>
        </div>
        <div className="flex justify-between gap-3 text-[13px]">
          <span className="text-muted-foreground">Folder served to the phone</span>
          <code className="text-xs [overflow-wrap:anywhere] text-right">{info.serve_root}</code>
        </div>
      </CardContent>
    </Card>
  );
}
