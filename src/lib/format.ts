export function fmtSize(n: number): string {
  if (n >= 1 << 30) return (n / (1 << 30)).toFixed(1) + " GB";
  if (n >= 1 << 20) return (n / (1 << 20)).toFixed(1) + " MB";
  if (n >= 1 << 10) return (n / (1 << 10)).toFixed(1) + " KB";
  return n + " B";
}

export type FileKind =
  | "dir"
  | "photo"
  | "image"
  | "video"
  | "audio"
  | "file"
  | "app"
  | "media";

// 'photo' = JPEG with a fetchable EXIF thumbnail; other images keep icons.
const FILE_KINDS: Record<string, FileKind> = {
  jpg: "photo",
  jpeg: "photo",
  png: "image",
  heic: "image",
  heif: "image",
  gif: "image",
  webp: "image",
  tif: "image",
  tiff: "image",
  bmp: "image",
  mov: "video",
  mp4: "video",
  m4v: "video",
  avi: "video",
  mp3: "audio",
  m4a: "audio",
  aac: "audio",
  wav: "audio",
  caf: "audio",
  aiff: "audio",
};

export function fileKind(name: string): FileKind {
  const ext = name.includes(".")
    ? (name.split(".").pop() ?? "").toLowerCase()
    : "";
  return FILE_KINDS[ext] ?? "file";
}
