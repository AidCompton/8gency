"use client";
import { X } from "@phosphor-icons/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { stepPath, TOUR_STEPS } from "@/lib/domain/tour";
import { buttonClass } from "./ui";

const KEY = "8g-tour";

/** The first matching element that is actually on screen (React streams content into a hidden holder first, which has no size). */
const visible = (selector: string) => [...document.querySelectorAll(selector)].find((el) => el.getBoundingClientRect().height > 0) ?? null;
const read = () => {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
};
const write = (v: number | null) => {
  try {
    if (v === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(v));
  } catch {}
};

/** The pop-up walkthrough of the sample agency. Starts from "?tour=1" and follows the user across pages. */
export function Tour({ jobId }: { jobId: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [step, setStep] = useState<number | null>(null);
  const [box, setBox] = useState<{ top: number; left: number; w: number; h: number } | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Start from the link, otherwise carry on where we were.
  useEffect(() => {
    if (params.get("tour")) {
      write(0);
      setStep(0);
      router.replace(pathname);
    } else setStep(read());
  }, [params, pathname, router]);

  const current = step !== null ? TOUR_STEPS[step] : null;
  const here = current ? stepPath(current, jobId).split("?")[0] === pathname : false;

  // Point at the target, and keep the card on screen.
  const place = useCallback(() => {
    if (!current || !here) return;
    const el = visible(current.target);
    if (el) {
      const r = el.getBoundingClientRect();
      setBox({ top: r.top + window.scrollY, left: r.left + window.scrollX, w: r.width, h: r.height });
    } else setBox(null);
  }, [current, here]);

  // The page streams in after the layout: watch for the target to appear (for up to 15 seconds), then point at it.
  useEffect(() => {
    if (!here) return;
    let done = false;
    const look = () => {
      const el = visible(current!.target);
      if (!el || done) return;
      done = true;
      observer.disconnect();
      el.scrollIntoView({ block: el.getBoundingClientRect().height > window.innerHeight * 0.6 ? "start" : "center", behavior: "auto" });
      place();
    };
    const observer = new MutationObserver(look);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "style"] });
    look();
    const giveUp = setTimeout(() => (observer.disconnect(), !done && place()), 15000);
    window.addEventListener("resize", place);
    return () => (observer.disconnect(), clearTimeout(giveUp), window.removeEventListener("resize", place));
  }, [here, current, place]);

  useLayoutEffect(() => {
    if (!here || !card.current) return;
    const c = card.current.getBoundingClientRect();
    const margin = 12;
    if (!box) return setPos({ top: Math.max(margin, (window.innerHeight - c.height) / 2) + window.scrollY, left: Math.max(margin, (window.innerWidth - c.width) / 2) });
    const tall = box.h > window.innerHeight * 0.55;
    const below = box.top + box.h + margin;
    if (tall) {
      // A big target: sit inside it, top right, just under its heading.
      return setPos({ top: box.top + 56, left: Math.max(margin, Math.min(box.left + box.w - c.width - margin, window.innerWidth - c.width - margin)) });
    }
    const fits = below + c.height < window.scrollY + window.innerHeight;
    setPos({ top: fits ? below : Math.max(window.scrollY + margin, box.top - c.height - margin), left: Math.min(Math.max(margin, box.left), window.innerWidth - c.width - margin) });
  }, [box, here, step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && stop();
    if (here) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const stop = () => (write(null), setStep(null), setBox(null));
  const go = (n: number) => {
    if (n >= TOUR_STEPS.length) return stop();
    write(n);
    setStep(n);
    setBox(null);
    setPos(null);
    router.push(stepPath(TOUR_STEPS[n], jobId));
  };

  if (step === null || !current || !here) return null;
  const last = step === TOUR_STEPS.length - 1;
  return (
    <>
      {box && <div aria-hidden className="pointer-events-none absolute z-40 rounded-xl ring-2 ring-brand ring-offset-2 ring-offset-bg transition-all" style={{ top: box.top - 4, left: box.left - 4, width: box.w + 8, height: box.h + 8 }} />}
      <div ref={card} role="dialog" aria-label={`Tour, step ${step + 1} of ${TOUR_STEPS.length}`} className="absolute z-50 w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border border-line bg-surface p-4 shadow-md" style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-sm font-semibold">{current.title}</h2>
          <button type="button" onClick={stop} aria-label="End the tour" className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink"><X aria-hidden size={14} /></button>
        </div>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{current.body}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="text-xs text-ink-3">{step + 1} of {TOUR_STEPS.length}</span>
          <span className="flex gap-2">
            {step > 0 && <button type="button" onClick={() => go(step - 1)} className={buttonClass("ghost", "sm")}>Back</button>}
            <button type="button" autoFocus onClick={() => go(step + 1)} className={buttonClass("primary", "sm")}>{last ? "Finish" : "Next"}</button>
          </span>
        </div>
      </div>
    </>
  );
}
