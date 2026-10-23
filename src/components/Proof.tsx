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
  const place = (x: number, y: number) => {
    x = Math.min(100, Math.max(0, Math.round(x * 10) / 10));
    y = Math.min(100, Math.max(0, Math.round(y * 10) / 10));
    setPin({ x, y });
    set("pin_x", String(x));
    set("pin_y", String(y));
  };
  const focusComment = () => (document.getElementById(formId)?.querySelector("textarea") as HTMLTextAreaElement | null)?.focus();
  const isImage = mime.startsWith("image/");
  const isVideo = mime.startsWith("video/");
  return (
    <div>
      {isImage && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Pin a comment to the image. Arrow keys move the pin, Enter writes the comment."
          className="relative cursor-crosshair overflow-hidden rounded-lg border border-line bg-surface-2"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
            place(((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100);
            focusComment();
          }}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 10 : 2;
            const p = pin ?? { x: 50, y: 50 };
            const move: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
            if (move[e.key]) {
              e.preventDefault();
              place(p.x + (pin ? move[e.key][0] : 0), p.y + (pin ? move[e.key][1] : 0));
            } else if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (!pin) place(50, 50);
              focusComment();
            }
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="Version preview" className="block w-full" loading="lazy" />
          {comments.filter((c) => c.pin_x !== null).map((c, i) => (
            <span
              key={c.id}
              role="img"
              aria-label={`Pin ${i + 1}, ${c.is_client ? "client" : "internal"}: ${c.author_name}: ${c.body}`}
              title={`${c.author_name}: ${c.body}`}
              className={`absolute grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white text-xs font-bold text-white shadow ${c.is_client ? "bg-pin-client" : "bg-seq"}`}
              style={{ left: `${c.pin_x}%`, top: `${c.pin_y}%` }}
            >
              {i + 1}
            </span>
          ))}
          {pin && <span aria-hidden className="absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full border-2 border-white bg-ink/70" style={{ left: `${pin.x}%`, top: `${pin.y}%` }} />}
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
      {isImage && <p className="mt-2 text-xs text-ink-3">Click the image (or focus it and use the arrow keys) to pin a comment to a spot. Blue pins are internal, orange are client.</p>}
    </div>
  );
}
