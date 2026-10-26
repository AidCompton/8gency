"use client";
import { X } from "@phosphor-icons/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

interface Toast {
  id: number;
  message: string;
  /** Puts things back. Present for anything reversible: the toast shows an Undo button. */
  undo?: () => void | Promise<void>;
  ms: number;
}

let toasts: Toast[] = [];
let next = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
const dismiss = (id: number) => {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
};

/** Show a message from anywhere in the app. With `undo`, it stays 8 seconds with an Undo button. */
export function toast(t: { message: string; undo?: Toast["undo"]; ms?: number }) {
  toasts = [...toasts.slice(-2), { id: next++, message: t.message, undo: t.undo, ms: t.ms ?? (t.undo ? 8000 : 4000) }];
  emit();
}

function ToastItem({ t }: { t: Toast }) {
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const paused = useRef(false);
  const left = useRef(t.ms);
  useEffect(() => {
    setShown(true);
    let last = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      if (!paused.current) left.current -= now - last;
      last = now;
      if (left.current <= 0) dismiss(t.id);
    }, 200);
    return () => clearInterval(timer);
  }, [t.id]);
  return (
    <div
      onMouseEnter={() => (paused.current = true)}
      onMouseLeave={() => (paused.current = false)}
      onFocus={() => (paused.current = true)}
      onBlur={() => (paused.current = false)}
      className={`pointer-events-auto flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm shadow-md transition-[opacity,transform] duration-200 ${shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}`}
    >
      <span className="min-w-0 flex-1 font-medium">{t.message}</span>
      {t.undo && (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await t.undo?.();
            dismiss(t.id);
          }}
          className="rounded-md px-2 py-1 font-semibold text-brand hover:bg-brand/10 disabled:opacity-50 pointer-coarse:min-h-11"
        >
          Undo
        </button>
      )}
      <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="-mr-1 grid h-7 w-7 place-items-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11">
        <X aria-hidden size={14} />
      </button>
    </div>
  );
}

/** Mounted once in the app layout. A polite live region, so screen readers announce each toast without interrupting. */
export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => toasts, () => toasts);
  return (
    <div role="status" aria-live="polite" className="no-print pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      {list.map((t) => <ToastItem key={t.id} t={t} />)}
    </div>
  );
}
