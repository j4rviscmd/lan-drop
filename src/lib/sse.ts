export interface UploadProgress {
  file: string;
  total: number;
  received: number;
}

export interface UploadDone {
  file: string;
  size: number;
  /** Set for PC-initiated USB pulls — the pull UI already reports completion. */
  local?: boolean;
}

/** Subscribe to the loopback SSE transfer stream; returns a cleanup function. */
export function subscribeUploads(
  loopbackPort: number,
  on: {
    progress: (e: UploadProgress) => void;
    done: (e: UploadDone) => void;
  },
): () => void {
  const es = new EventSource(`http://127.0.0.1:${loopbackPort}/api/events`);
  es.addEventListener("upload-progress", (ev) =>
    on.progress(JSON.parse((ev as MessageEvent).data)),
  );
  es.addEventListener("upload-done", (ev) => on.done(JSON.parse((ev as MessageEvent).data)));
  return () => es.close();
}
