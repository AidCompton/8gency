"use client";
import { X } from "@phosphor-icons/react";
import { useRef, type PointerEvent, type ReactNode } from "react";
import { cx } from "./ui";

/**
 * A window over the page: the trigger opens it, Escape or a click outside closes it.
 * The body is server-rendered, so forms inside keep using server actions. It closes itself
 * when a form in it is submitted; the page then refreshes underneath. On phones it is a bottom
 * sheet: drag the top down and it follows your finger, closing on distance or a quick flick.
 * The close button stays for anyone who would rather tap.
 */
export function Dialog({ trigger, title, subtitle, children, triggerClassName, triggerLabel }: {
  trigger: ReactNode; title: ReactNode; subtitle?: ReactNode; children: ReactNode; triggerClassName?: string; triggerLabel?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const drag = useRef<{ y: number; t: number; dy: number } | null>(null);
  const start = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType === "mouse" || !matchMedia("(max-width: 639px)").matches || (e.target as HTMLElement).closest("button")) return;
    drag.current = { y: e.clientY, t: performance.now(), dy: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (ref.current) ref.current.style.transition = "none";
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    if (!drag.current || !ref.current) return;
    drag.current.dy = Math.max(0, e.clientY - drag.current.y);
    ref.current.style.transform = `translateY(${drag.current.dy}px)`;
  };
  const end = () => {
    const d = drag.current;
    const el = ref.current;
    drag.current = null;
    if (!d || !el) return;
    el.style.transition = ""; // the CSS transition now carries it on from wherever the finger left it
    const flick = d.dy / Math.max(1, performance.now() - d.t) > 0.5 && d.dy > 30;
    if (d.dy > 120 || flick) {
      el.style.transform = "translateY(100%)";
      setTimeout(() => (el.close(), (el.style.transform = "")), 200);
    } else el.style.transform = "";
  };
  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()} aria-haspopup="dialog" aria-label={triggerLabel} className={triggerClassName}>
        {trigger}
      </button>
      <dialog
        ref={ref}
        onClick={(e) => e.target === ref.current && ref.current?.close()}
        onSubmit={() => setTimeout(() => ref.current?.close(), 0)}
        className="app-dialog"
      >
        <div onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} className="touch-none border-b border-line">
          <div aria-hidden className="mx-auto mt-2 h-1 w-10 rounded-full bg-line sm:hidden" />
          <div className="flex items-start justify-between gap-4 px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-sm text-ink-3">{subtitle}</p>}
          </div>
          <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className={cx("-mr-2 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink")}>
            <X aria-hidden size={18} />
          </button>
          </div>
        </div>
        <div className="px-6 py-5">{children}</div>
      </dialog>
    </>
  );
}
