"use client";
import {
  Briefcase, Buildings, CalendarPlus, CaretDoubleLeft, CaretDoubleRight, ChatsCircle, ChartLineUp, ClockCounterClockwise, Clock, Gear, House, Lightning, List, UsersThree, PaperPlaneTilt, Receipt, Repeat, ShieldCheck, SunHorizon, X,
  type Icon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { goKeys } from "@/lib/domain/shortcuts";
import { Kbd, shortcutText, useIsMac } from "./Kbd";
import { useState, type ReactNode } from "react";

// Icons live here (not in the server layout) because components can't cross the server/client boundary as props.
const ICONS: Record<string, Icon> = {
  home: House, myday: SunHorizon, jobs: Briefcase, clients: Buildings, scope: ShieldCheck, time: Clock, chat: ChatsCircle, bookings: CalendarPlus, team: UsersThree,
  retainers: Repeat, billing: Receipt, pulse: ChartLineUp, automations: Lightning, settings: Gear, audit: ClockCounterClockwise, outbox: PaperPlaneTilt,
};

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  group: string;
  badge?: number;
}

/** One sidebar link's shortcut, shown on hover and in its tooltip. */
function NavHint({ href }: { href: string }) {
  const keys = goKeys(href);
  return keys ? <Kbd keys={keys} className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-md bg-surface-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 md:inline-flex" /> : null;
}

/**
 * Sidebar from md up, which can be minimised to an icon rail (remembered in a
 * cookie so the server renders the right width); a drop-down menu on phones.
 * `account` (avatar, role, log out) sits under the links.
 */
export function NavLinks({
  items, brand, brandMark, account, accountMark, initialCollapsed,
}: {
  items: NavItem[];
  brand: ReactNode;
  /** Small brand for the minimised rail. */
  brandMark: ReactNode;
  account: ReactNode;
  accountMark: ReactNode;
  initialCollapsed: boolean;
}) {
  const path = usePathname();
  const mac = useIsMac();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.getElementById("app-shell")?.setAttribute("data-nav", next ? "collapsed" : "open");
    document.cookie = `8g_nav=${next ? "collapsed" : "open"}; path=/; max-age=31536000; samesite=lax`;
  };
  // Minimised only applies from md up; phones always get the full drop-down.
  const mini = (full: string, small: string) => (collapsed ? small : full);
  const groups = [...new Set(items.map((i) => i.group))];
  return (
    <>
      <div className={`flex h-14 items-center justify-between gap-2 border-b border-line px-4 md:h-16 ${mini("", "md:justify-center md:px-2")}`}>
        <span className={mini("contents", "contents md:hidden")}>{brand}</span>
        {collapsed && <span className="hidden md:contents">{brandMark}</span>}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls="app-nav"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink-2 shadow-xs transition-colors hover:bg-surface-2 pointer-coarse:min-h-11 md:hidden"
        >
          {open ? <X aria-hidden size={16} /> : <List aria-hidden size={16} />}
          {open ? "Close" : "Menu"}
        </button>
      </div>
      <div id="app-nav" className={`${open ? "block" : "hidden"} md:flex md:min-h-0 md:flex-1 md:flex-col`}>
        <nav aria-label="Main" className={`px-3 py-3 md:min-h-0 md:flex-1 md:overflow-y-auto ${mini("", "md:px-2")}`}>
          {groups.map((g) => (
            <div key={g} className={`mb-4 last:mb-0 ${mini("", "md:mb-2 md:border-b md:border-line md:pb-2 md:last:border-0")}`}>
              {g && <div className={`mb-1 px-2.5 text-xs font-medium text-ink-3 ${mini("", "md:sr-only")}`}>{g}</div>}
              <ul className="space-y-0.5">
                {items
                  .filter((i) => i.group === g)
                  .map((i) => {
                    const active = i.href === "/app" ? path === "/app" : path.startsWith(i.href);
                    const Icon = ICONS[i.icon];
                    return (
                      <li key={i.href}>
                        <Link
                          href={i.href}
                          onClick={() => setOpen(false)}
                          aria-current={active ? "page" : undefined}
                          title={goKeys(i.href) ? `${i.label} · ${shortcutText(goKeys(i.href), mac)}` : collapsed ? i.label : undefined}
                          className={`group relative flex items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm transition-colors pointer-coarse:py-3 ${mini("", "md:justify-center md:px-0 md:py-2")} ${
                            active ? "bg-brand/10 font-medium text-brand" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
                          }`}
                        >
                          <Icon aria-hidden size={18} weight={active ? "fill" : "regular"} className={`shrink-0 ${active ? "" : "text-ink-3 transition-colors group-hover:text-ink-2"}`} />
                          <span className={`min-w-0 flex-1 truncate ${mini("", "md:sr-only")}`}>{i.label}</span>
                          {!i.badge && <NavHint href={i.href} />}
                          {i.badge ? (
                            <span className={`tnum min-w-5 rounded-full bg-brand px-1.5 text-center text-xs font-medium leading-5 text-brand-ink ${mini("", "md:absolute md:right-1 md:top-0.5 md:min-w-4 md:px-1 md:text-[10px] md:leading-4")}`}>
                              {i.badge}
                              <span className="sr-only"> waiting</span>
                            </span>
                          ) : null}
                        </Link>
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
        </nav>
        <div className={`border-t border-line p-3 ${mini("", "md:px-2")}`}>
          <div className={mini("", "md:hidden")}>{account}</div>
          {collapsed && <div className="hidden md:block">{accountMark}</div>}
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? "Expand menu" : "Minimise menu"}
            title={collapsed ? "Expand menu" : "Minimise menu"}
            className={`mt-2 hidden w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink md:flex ${mini("", "md:justify-center md:px-0")}`}
          >
            {collapsed ? <CaretDoubleRight aria-hidden size={16} /> : <CaretDoubleLeft aria-hidden size={16} />}
            {!collapsed && "Minimise"}
          </button>
        </div>
      </div>
    </>
  );
}
