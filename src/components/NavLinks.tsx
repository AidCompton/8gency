"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({ items }: { items: { href: string; label: string; badge?: number }[] }) {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto px-2 pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
      {items.map((i) => {
        const active = i.href === "/app" ? path === "/app" : path.startsWith(i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            className={`flex items-center justify-between whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${active ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}
          >
            {i.label}
            {i.badge ? <span className="ml-2 rounded-full bg-brand/15 px-1.5 text-xs text-brand">{i.badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
