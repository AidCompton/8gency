"use client";
import { MagnifyingGlass, Moon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { COMMAND_KEYS, goKeys, hrefForGoKey, THEME_KEYS } from "@/lib/domain/shortcuts";
import { Kbd, useShortcutText } from "./Kbd";
import { toggleTheme } from "./ThemeToggle";
import { cx } from "./ui";

export interface CommandItem {
  id: string;
  label: string;
  /** Where it goes; leave out for the built-in actions. */
  href?: string;
  group: "Go to" | "Actions";
  keywords?: string;
}

/** Every word typed must appear (or start a word) in the label or keywords; earlier and word-start matches rank first. */
function score(item: CommandItem, q: string): number {
  if (!q) return 1;
  const hay = `${item.label} ${item.keywords ?? ""}`.toLowerCase();
  const label = item.label.toLowerCase();
  let total = 0;
  for (const w of q.toLowerCase().split(/\s+/).filter(Boolean)) {
    const at = hay.indexOf(w);
    if (at < 0) return 0;
    total += (label.startsWith(w) ? 4 : hay.includes(` ${w}`) ? 2 : 1) + (at === 0 ? 1 : 0);
  }
  return total;
}

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.getAttribute("role") === "textbox");

/**
 * ⌘K / Ctrl+K: search every page and action, keyboard only. Also owns the global shortcuts:
 * "G then a letter" to jump to a page, ⇧⌘L / Ctrl+Shift+L for light or dark. None of the
 * single-key ones fire while someone is typing in a field or a dialog is open.
 */
export function CommandMenu({ items }: { items: CommandItem[] }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const triggerHint = useShortcutText(COMMAND_KEYS);

  const all: CommandItem[] = useMemo(() => [...items, { id: "theme", label: "Switch between light and dark", group: "Actions", keywords: "theme appearance mode" }], [items]);
  const results = useMemo(
    () => all.map((i) => ({ i, s: score(i, q) })).filter((r) => r.s > 0).sort((a, b) => (q ? b.s - a.s : 0)).map((r) => r.i),
    [all, q],
  );

  const open = () => {
    setQ("");
    setActive(0);
    if (!ref.current?.open) ref.current?.showModal();
    requestAnimationFrame(() => input.current?.focus());
  };
  const close = () => ref.current?.close();
  const run = (i: CommandItem) => {
    close();
    if (i.id === "theme") toggleTheme();
    else if (i.href) router.push(i.href);
  };

  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | null = null;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (ref.current?.open) close();
        else open();
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        toggleTheme();
        return;
      }
      if (mod || e.altKey || e.isComposing || typing(e.target) || document.querySelector("dialog[open]")) return;
      if (pending) {
        clearTimeout(pending);
        pending = null;
        const href = hrefForGoKey(e.key);
        if (href && items.some((i) => i.href === href)) {
          e.preventDefault();
          router.push(href);
        }
        return;
      }
      if (e.key.toLowerCase() === "g") pending = setTimeout(() => (pending = null), 1200);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (pending) clearTimeout(pending);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, router]);

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (results.length ? (a + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length : 0));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : Math.max(0, results.length - 1));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      run(results[active]);
    }
  };
  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);

  const groups = (["Go to", "Actions"] as const).map((g) => ({ g, rows: results.filter((r) => r.group === g) })).filter((x) => x.rows.length);
  let n = -1;
  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-label="Search pages and actions"
        title={`Search · ${triggerHint}`}
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-sm text-ink-3 shadow-xs transition-colors hover:bg-surface-2 hover:text-ink pointer-coarse:h-11 sm:px-3"
      >
        <MagnifyingGlass aria-hidden size={16} />
        <span className="hidden sm:inline">Search</span>
        <Kbd keys={COMMAND_KEYS} className="hidden sm:inline-flex" />
      </button>
      <dialog ref={ref} aria-label="Command menu" onClick={(e) => e.target === ref.current && close()} className="app-dialog cmd-dialog">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <MagnifyingGlass aria-hidden size={18} className="shrink-0 text-ink-3" />
          <input
            ref={input}
            value={q}
            onChange={(e) => (setQ(e.target.value), setActive(0))}
            onKeyDown={onInputKey}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
            aria-label="Search pages and actions"
            placeholder="Go to a page or do something…"
            autoComplete="off"
            spellCheck={false}
            className="!h-14 !border-0 !bg-transparent !px-0 !shadow-none focus-visible:!shadow-none"
          />
          <kbd className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-xs text-ink-3">Esc</kbd>
        </div>
        <ul id={listId} role="listbox" aria-label="Results" className="max-h-[min(24rem,60vh)] overflow-y-auto p-2">
          {groups.map(({ g, rows }) => (
            <li key={g} role="presentation">
              <div className="px-2.5 pb-1 pt-2 text-xs font-medium text-ink-3">{g}</div>
              <ul role="presentation">
                {rows.map((r) => {
                  const idx = ++n;
                  const keys = r.id === "theme" ? THEME_KEYS : r.group === "Go to" && r.href ? goKeys(r.href) : undefined;
                  return (
                    <li
                      key={r.id}
                      id={`${listId}-${idx}`}
                      role="option"
                      aria-selected={idx === active}
                      onMouseMove={() => setActive(idx)}
                      onClick={() => run(r)}
                      className={cx("flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-[0.9375rem]", idx === active ? "bg-brand/10 text-ink" : "text-ink-2")}
                    >
                      {r.id === "theme" && <Moon aria-hidden size={16} className="shrink-0 text-ink-3" />}
                      <span className="min-w-0 flex-1 truncate">{r.label}</span>
                      {keys && <Kbd keys={keys} />}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
          {!results.length && <li role="presentation" className="px-3 py-8 text-center text-sm text-ink-3">Nothing matches “{q}”.</li>}
        </ul>
        <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-xs text-ink-3">
          <span><kbd className="rounded border border-line bg-surface-2 px-1">↑</kbd> <kbd className="rounded border border-line bg-surface-2 px-1">↓</kbd> to move</span>
          <span><kbd className="rounded border border-line bg-surface-2 px-1">Enter</kbd> to open</span>
        </div>
      </dialog>
    </>
  );
}
