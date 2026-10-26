"use client";
import { useSyncExternalStore } from "react";
import { cx } from "./ui";

const subscribe = () => () => {};
/** ⌘ on Apple devices, Ctrl elsewhere. The server and first paint use Ctrl so hydration matches. */
export const useIsMac = () => useSyncExternalStore(subscribe, () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent), () => false);

const label = (k: string, mac: boolean) => (k === "mod" ? (mac ? "⌘" : "Ctrl") : k === "shift" ? (mac ? "⇧" : "Shift") : k === "alt" ? (mac ? "⌥" : "Alt") : k);

/** Plain text for tooltips: "Ctrl+Shift+L" or "⌘⇧L", "G then J". */
export const shortcutText = (keys: string[] | undefined, mac: boolean) =>
  !keys ? "" : keys.length === 2 && keys[0] === "G" ? `G then ${keys[1]}` : keys.map((k) => label(k, mac)).join(mac ? "" : "+");

export function useShortcutText(keys: string[] | undefined) {
  return shortcutText(keys, useIsMac());
}

/** A keyboard shortcut drawn as keycaps. */
export function Kbd({ keys, className }: { keys: string[]; className?: string }) {
  const mac = useIsMac();
  const sequence = keys.length === 2 && keys[0] === "G";
  return (
    <span className={cx("inline-flex items-center gap-1 text-ink-3", className)} aria-hidden>
      {keys.map((k, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {sequence && i === 1 && <span className="text-xs">then</span>}
          <kbd className="min-w-5 rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-center font-sans text-xs font-medium leading-4 text-ink-2">{label(k, mac)}</kbd>
        </span>
      ))}
    </span>
  );
}
