"use client";
import { At, CaretRight, Compass, House, PencilSimpleLine, Plus } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { CATEGORIES, channelTitle } from "@/lib/domain/chat";
import type { ChatChannel } from "@/lib/services/chat";
import { Avatar, cx } from "./ui";

const KEY = "8g-chat-sidebar";

/** The conversation list, Slack-style: Home and Mentions up top, sections you can fold away, unread ones always visible. */
export function ChatSidebar({ channels, current, unread, online, me, mentions, onNavigate }: {
  channels: ChatChannel[]; current: string; unread: Record<string, number>; online: Set<string>; me: string; mentions: number; onNavigate: () => void;
}) {
  const [closed, setClosed] = useState<string[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) ?? "{}");
      setClosed(Array.isArray(s.closed) ? s.closed : []);
      setUnreadOnly(Boolean(s.unreadOnly));
    } catch {}
  }, []);
  const save = (next: { closed?: string[]; unreadOnly?: boolean }) => {
    const v = { closed, unreadOnly, ...next };
    setClosed(v.closed);
    setUnreadOnly(v.unreadOnly);
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {}
  };

  const count = (c: ChatChannel) => (c.id === current ? 0 : (unread[c.id] ?? c.unread));
  const groups = CATEGORIES.map((c) => ({ key: c.key as string, label: c.label as string, items: channels.filter((x) => x.kind === "channel" && x.category === c.key) })).filter((g) => g.items.length);
  const dms = channels.filter((c) => c.kind === "dm");
  const totalUnread = channels.reduce((s, c) => s + count(c), 0);

  const row = (c: ChatChannel, icon: ReactNode, label: string) => {
    const n = count(c);
    return (
      <li key={c.id}>
        <Link
          href={`/app/chat/${c.id}`}
          onClick={onNavigate}
          aria-current={c.id === current ? "page" : undefined}
          className={cx("flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors pointer-coarse:py-2.5", c.id === current ? "bg-brand/10 font-medium text-brand" : n ? "font-semibold text-ink hover:bg-surface-2" : "text-ink-2 hover:bg-surface-2 hover:text-ink")}
        >
          {icon}
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {n > 0 && <span className="tnum min-w-5 rounded-full bg-brand px-1.5 text-center text-xs font-semibold leading-5 text-brand-ink">{n > 99 ? "99+" : n}<span className="sr-only"> unread</span></span>}
        </Link>
      </li>
    );
  };

  /** A folded or unread-only section still shows what has news and where you are. */
  const section = (key: string, label: string, items: ChatChannel[], render: (c: ChatChannel) => ReactNode, extra?: ReactNode, empty?: ReactNode) => {
    const shut = closed.includes(key);
    const shown = shut || unreadOnly ? items.filter((c) => count(c) > 0 || c.id === current) : items;
    const hidden = items.length - shown.length;
    return (
      <section key={key}>
        <h3 className="mb-1 flex items-center justify-between px-1 text-xs font-medium text-ink-3">
          <button type="button" aria-expanded={!shut} onClick={() => save({ closed: shut ? closed.filter((k) => k !== key) : [...closed, key] })} className="flex items-center gap-1 rounded px-1 py-0.5 hover:text-ink">
            <CaretRight aria-hidden size={11} weight="bold" className={cx("transition-transform", !shut && "rotate-90")} />
            {label}
            {hidden > 0 && <span className="font-normal text-ink-3/70">· {hidden}</span>}
          </button>
          {extra}
        </h3>
        <ul className="space-y-0.5">{shown.map(render)}</ul>
        {!items.length && empty}
      </section>
    );
  };

  const top = "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink pointer-coarse:py-2.5";
  return (
    <nav aria-label="Conversations" className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-3">
        <span className="font-semibold">Chat</span>
        <Link href="/app/chat/new" onClick={onNavigate} title="New group or message" aria-label="New group or message" className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-brand-ink shadow-xs hover:opacity-90">
          <PencilSimpleLine aria-hidden size={16} weight="bold" />
        </Link>
      </div>
      <form action="/app/chat/search" role="search" className="px-2 pt-2">
        <input name="q" placeholder="Search messages" aria-label="Search messages" className="field-sm" />
      </form>
      <div className="space-y-0.5 px-2 pt-2">
        <Link href="/app/chat" onClick={onNavigate} aria-current={current === "" ? "page" : undefined} className={cx(top, current === "" && "bg-brand/10 font-medium text-brand")}>
          <House aria-hidden size={16} /> Home
        </Link>
        <Link href="/app/chat#mentions" onClick={onNavigate} className={cx(top, mentions > 0 && "font-semibold text-ink")}>
          <At aria-hidden size={16} /> <span className="flex-1">Mentions</span>
          {mentions > 0 && <span className="tnum min-w-5 rounded-full bg-warning px-1.5 text-center text-xs font-semibold leading-5 text-black">{mentions > 99 ? "99+" : mentions}<span className="sr-only"> unread mentions</span></span>}
        </Link>
        <Link href="/app/chat/browse" onClick={onNavigate} className={top}><Compass aria-hidden size={16} /> Browse channels</Link>
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-line px-3 pt-2 text-xs text-ink-3">
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={unreadOnly} onChange={(e) => save({ unreadOnly: e.target.checked })} className="h-3.5 w-3.5 accent-[var(--color-brand)]" />
          Unreads only
        </label>
        {totalUnread > 0 && <span className="tnum">{totalUnread} unread</span>}
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2 py-3">
        {groups.map((g) => section(g.key, g.label, g.items, (c) => row(c, <span aria-hidden className="w-5 text-center text-[15px]">{c.emoji}</span>, c.name)))}
        {section(
          "dm",
          "Direct messages",
          dms,
          (c) => {
            const live = c.people.some((p) => online.has(p.id) && p.id !== me);
            return row(
              c,
              <span className="relative shrink-0">
                <Avatar name={c.people[0]?.name ?? "?"} size="sm" />
                <span aria-hidden className={cx("absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface", live ? "bg-good" : "bg-ink-3/40")} />
              </span>,
              channelTitle(c),
            );
          },
          <Link href="/app/chat/new#direct" onClick={onNavigate} className="rounded text-ink-3 hover:text-brand" aria-label="New direct message"><Plus aria-hidden size={14} /></Link>,
          <p className="px-2 text-xs text-ink-3">Message anyone on the team from the + above.</p>,
        )}
      </div>
    </nav>
  );
}
