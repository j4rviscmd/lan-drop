import { api } from "@lib/api";
import type { ServerInfo } from "@lib/types";
import { useCallback, useEffect, useState } from "react";

/** server_info fetch + refresh after runtime changes (upload folder switch). */
export function useServerInfo() {
  const [info, setInfo] = useState<ServerInfo | null>(null);

  const refresh = useCallback(() => {
    api
      .serverInfo()
      .then(setInfo)
      .catch((e) => console.error("server_info failed:", e));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { info, refresh };
}
