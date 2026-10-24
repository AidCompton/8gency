"use client";
import {
  Briefcase, Buildings, ChartLineUp, ClockCounterClockwise, Clock, Gear, House, Lightning, List, UsersThree, PaperPlaneTilt, Receipt, Repeat, ShieldCheck, SunHorizon, X,
  type Icon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

// Icons live here (not in the server layout) because components can't cross the server/client boundary as props.
const ICONS: Record<string, Icon> = {
  home: House, myday: SunHorizon, jobs: Briefcase, clients: Buildings, scope: ShieldCheck, time: Clock, team: UsersThree,
  retainers: Repeat, billing: Receipt, pulse: ChartLineUp, automations: Lightning, settings: Gear, audit: ClockCounterClockwise, outbox: PaperPlaneTilt,
};

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  group: string;
  badge?: number;
}

/** Sidebar from md up; a collapsible menu on phones. `account` (avatar, role, log out) sits under the links. */
export function NavLinks({ items, brand, account }: { items: NavItem[]; brand: ReactNode; account: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const groups = [...new Set(items.map((i) => i.group))];
  return (
    <>
      <div className="flex h-14 items-center justify-between gap-2 border-b border-line px-4 md:h-16">
        {brand}
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
        <nav aria-label="Main" className="px-3 py-3 md:min-h-0 md:flex-1 md:overflow-y-auto">
          {groups.map((g) => (
            <div key={g} className="mb-4 last:mb-0">
              {g && <div className="mb-1 px-2.5 text-xs font-medium text-ink-3">{g}</div>}
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
                          className={`group flex items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm transition-colors pointer-coarse:py-3 ${
                            active ? "bg-brand/10 font-medium text-brand" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
                          }`}
                        >
                          <Icon aria-hidden size={18} weight={active ? "fill" : "regular"} className={active ? "" : "text-ink-3 transition-colors group-hover:text-ink-2"} />
                          <span className="flex-1">{i.label}</span>
                          {i.badge ? (
                            <span className="tnum min-w-5 rounded-full bg-brand px-1.5 text-center text-xs font-medium leading-5 text-brand-ink">
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
        <div className="border-t border-line p-3">{account}</div>
      </div>
    </>
  );
}
