"use client";
import { Desktop, Moon, Sun } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { THEME_KEYS } from "@/lib/domain/shortcuts";
import { useShortcutText } from "./Kbd";
import { cx } from "./ui";

export type Theme = "light" | "dark" | "system";

/** The choice lives in a cookie so the server can render the right theme on the first paint. */
function apply(t: Theme) {
  const root = document.documentElement;
  if (t === "system") {
    root.removeAttribute("data-theme");
    document.cookie = "8g_theme=; path=/; max-age=0; samesite=lax";
  } else {
    root.setAttribute("data-theme", t);
    document.cookie = `8g_theme=${t}; path=/; max-age=31536000; samesite=lax`;
  }
}

const current = (): Theme => {
  const t = document.documentElement.getAttribute("data-theme");
  return t === "light" || t === "dark" ? t : "system";
};

const prefersDark = () => current() === "dark" || (current() === "system" && matchMedia("(prefers-color-scheme: dark)").matches);

/** Flip between light and dark (⇧⌘L), with a short cross-fade where the browser supports view transitions. */
export function toggleTheme() {
  const next: Theme = prefersDark() ? "light" : "dark";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduce && "startViewTransition" in document) (document as Document & { startViewTransition: (cb: () => void) => unknown }).startViewTransition(() => apply(next));
  else apply(next);
}

/** One-tap switch for the top bar: flips between light and dark. */
export function ThemeButton() {
  const [dark, setDark] = useState(false);
  const hint = useShortcutText(THEME_KEYS);
  useEffect(() => {
    const read = () => setDark(current() === "dark" || (current() === "system" && matchMedia("(prefers-color-scheme: dark)").matches));
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={`${dark ? "Light mode" : "Dark mode"} · ${hint}`}
      className="grid h-9 w-9 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11"
    >
      {dark ? <Sun aria-hidden size={20} /> : <Moon aria-hidden size={20} />}
    </button>
  );
}

/** Light, dark or follow the device: the full choice, for the account page. */
export function ThemePicker({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);
  useEffect(() => setTheme(current()), []);
  const options: { key: Theme; label: string; icon: typeof Sun; hint: string }[] = [
    { key: "light", label: "Light", icon: Sun, hint: "Bright and clean" },
    { key: "dark", label: "Dark", icon: Moon, hint: "Easier in low light" },
    { key: "system", label: "Match my device", icon: Desktop, hint: "Switches with your computer" },
  ];
  return (
    <div role="radiogroup" aria-label="Theme" className="grid gap-3 sm:grid-cols-3">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={theme === o.key}
          onClick={() => (apply(o.key), setTheme(o.key))}
          className={cx("flex flex-col gap-2 rounded-xl border p-4 text-left transition-[border-color,background-color,box-shadow]", theme === o.key ? "border-brand bg-brand/5 shadow-[0_0_0_1px_var(--brand)]" : "border-line bg-surface hover:border-ink-3/50")}
        >
          <o.icon aria-hidden size={22} weight={theme === o.key ? "fill" : "regular"} className={theme === o.key ? "text-brand" : "text-ink-3"} />
          <span className="font-medium">{o.label}</span>
          <span className="text-xs text-ink-3">{o.hint}</span>
        </button>
      ))}
    </div>
  );
}
