// What people may attach in chat, and how each kind is served back.

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_MESSAGE = 5;
/** Per agency; this is a Postgres table, not a file store. */
export const MAX_AGENCY_BYTES = 1024 * 1024 * 1024;

const IMAGE = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" } as const;
const OTHER = {
  pdf: "application/pdf", txt: "text/plain", csv: "text/csv", md: "text/markdown", zip: "application/zip", mp4: "video/mp4", mov: "video/quicktime",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  fig: "application/octet-stream", ai: "application/octet-stream", psd: "application/octet-stream", key: "application/octet-stream",
} as const;

const ext = (name: string) => name.toLowerCase().split(".").pop() ?? "";

/** A safe name to store and show: no path, no control characters. */
export const cleanFileName = (name: string) => name.replace(/[\\/\u0000-\u001f]+/g, "_").replace(/^\.+/, "").trim().slice(0, 120) || "file";

/** The type we'll store for a file name, from our own list (never the browser's claim), or null if the kind isn't allowed. */
export function allowedMime(name: string): string | null {
  const e = ext(name);
  return (IMAGE as Record<string, string>)[e] ?? (OTHER as Record<string, string>)[e] ?? null;
}

const SIGNATURES: Record<string, number[]> = {
  "image/png": [0x89, 0x50, 0x4e, 0x47],
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/gif": [0x47, 0x49, 0x46, 0x38],
  "image/webp": [0x52, 0x49, 0x46, 0x46],
};

/** Images are shown inline only when the bytes really are that image; everything else downloads. */
export function inlineImage(mime: string, head: Uint8Array) {
  const sig = SIGNATURES[mime];
  return Boolean(sig) && sig.every((b, i) => head[i] === b);
}

export const humanSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
