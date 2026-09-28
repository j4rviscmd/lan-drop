import { useEffect, useState } from "react";

import { api } from "@lib/api";
import type { ServerInfo } from "@lib/types";

/** One-shot server_info fetch; null until the backend answers. */
export function useServerInfo() {
  const [info, setInfo] = useState<ServerInfo | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .serverInfo()
      .then((i) => alive && setInfo(i))
      .catch((e) => console.error("server_info failed:", e));
    return () => {
      alive = false;
    };
  }, []);

  return info;
}
