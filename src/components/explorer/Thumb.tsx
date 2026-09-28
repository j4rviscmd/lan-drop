import { AppWindow, FileText, Film, Folder, HardDrive, Image, Music } from "lucide-react";
import { useEffect, useState } from "react";

import { useInView } from "@hooks/useInView";
import { api } from "@lib/api";
import type { FileKind } from "@lib/format";
import { cn } from "@lib/utils";

const ICONS: Record<FileKind, typeof Folder> = {
  dir: Folder,
  file: FileText,
  photo: Image,
  image: Image,
  video: Film,
  audio: Music,
  app: AppWindow,
  media: HardDrive,
};

// Fetch EXIF thumbnails only for tiles that scrolled into view.
// ponytail: JPEG only ('photo') — HEIC/MOV keep type icons until a decoder exists.
const cache = new Map<string, Promise<string | null>>();

function thumbUrl(udid: string, path: string, app: string | null) {
  const key = `${udid}|${path}|${app}`;
  let p = cache.get(key);
  if (!p) {
    p = api.usbThumbnail(udid, path, app).catch(() => null); // keep the type icon
    cache.set(key, p);
  }
  return p;
}

interface ThumbProps {
  udid: string;
  kind: FileKind;
  /** Absolute device path; absent for scope tiles (never fetched). */
  path?: string;
  app: string | null;
  /** Scroll container that gates lazy loading (IntersectionObserver root). */
  rootRef: React.RefObject<Element | null>;
  className?: string;
}

export function Thumb({ udid, kind, path, app, rootRef, className }: ThumbProps) {
  const { ref, inView } = useInView<HTMLSpanElement>(rootRef);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!inView || !path || kind !== "photo") return;
    let alive = true;
    void thumbUrl(udid, path, app).then((u) => {
      if (alive && u) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [inView, udid, path, app, kind]);

  const Icon = ICONS[kind];

  return (
    <span
      ref={ref}
      data-kind={kind}
      className={cn("grid shrink-0 place-items-center overflow-hidden", className)}
    >
      {url ? (
        <img src={url} alt="" className="block h-full w-full object-cover" />
      ) : (
        <Icon aria-hidden="true" className="size-full" strokeWidth={1.7} />
      )}
    </span>
  );
}
