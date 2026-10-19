"use client";
import { useRef, useState } from "react";

export interface ProofComment {
  id: string;
  author_name: string;
  body: string;
  pin_x: number | null;
  pin_y: number | null;
  timecode: number | null;
  is_client: boolean;
}

/**
 * Proofing viewer (M10): click an image to drop a pin, or comment at the
 * current video time. Writes the coordinates into the surrounding form.
 */
export function Proof({ src, mime, comments, formId }: { src: string; mime: string; comments: ProofComment[]; formId: string }) {
  const [pin, setPin] = useState<{ x: number; y: number } | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const set = (name: string, value: string) => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    const input = form?.elements.namedItem(name) as HTMLInputElement | null;
    if (input) input.value = value;
  };
  const isImage = mime.startsWith("image/");
  const isVideo = mime.startsWith("video/");
  return (
    <div>
      {isImage && (
        <div
          className="relative cursor-crosshair overflow-hidden rounded-lg border border-line bg-surface-2"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
            const x = Math.round(((e.clientX - r.left) / r.width) * 1000) / 10;
            const y = Math.round(((e.clientY - r.top) / r.height) * 1000) / 10;
            setPin({ x, y });
            set("pin_x", String(x));
            set("pin_y", String(y));
            (document.getElementById(formId)?.querySelector("textarea") as HTMLTextAreaElement | null)?.focus();
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="Version preview" className="block w-full" loading="lazy" />
          {comments.filter((c) => c.pin_x !== null).map((c, i) => (
            <span
              key={c.id}
              title={`${c.author_name}: ${c.body}`}
              className={`absolute grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white text-xs font-bold text-white shadow ${c.is_client ? "bg-[#eb6834]" : "bg-[#2a78d6]"}`}
              style={{ left: `${c.pin_x}%`, top: `${c.pin_y}%` }}
            >
              {i + 1}
            </span>
          ))}
          {pin && <span className="absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full border-2 border-white bg-ink/70" style={{ left: `${pin.x}%`, top: `${pin.y}%` }} />}
        </div>
      )}
      {isVideo && (
        <div>
          <video ref={video} src={src} controls className="w-full rounded-lg border border-line" preload="metadata" />
          <button type="button" className="mt-2 text-sm text-brand hover:underline" onClick={() => set("timecode", String(Math.round((video.current?.currentTime ?? 0) * 10) / 10))}>
            Comment at current time
          </button>
        </div>
      )}
      {mime === "application/pdf" && <iframe src={src} title="PDF preview" className="h-[70vh] w-full rounded-lg border border-line" />}
      {!isImage && !isVideo && mime !== "application/pdf" && (
        <a href={src} className="block rounded-lg border border-dashed border-line p-8 text-center text-sm text-brand hover:underline">Download this version</a>
      )}
      {isImage && <p className="mt-2 text-xs text-ink-3">Click the image to pin a comment to a spot. Blue pins are internal, orange are client.</p>}
    </div>
  );
}
