"use client";
import { List } from "@phosphor-icons/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { ChatChannel } from "@/lib/services/chat";
import { ChatSidebar } from "./ChatSidebar";
import { cx } from "./ui";

/** The chat frame for pages with no conversation open: the sidebar (kept live by polling) beside whatever page is passed in. */
export function ChatShell({ me, channels, mentions: mentions0, online: online0, children }: { me: string; channels: ChatChannel[]; mentions: number; online: string[]; children: ReactNode }) {
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [mentions, setMentions] = useState(mentions0);
  const [online, setOnline] = useState(new Set(online0));
  const [drawer, setDrawer] = useState(false);

  const poll = useCallback(async () => {
    const res = await fetch("/api/chat/overview", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return;
    const d: { unread: Record<string, number>; mentions: number; online: string[] } = await res.json();
    setUnread(d.unread);
    setMentions(d.mentions);
    setOnline(new Set(d.online));
  }, []);
  useEffect(() => {
    const t = setInterval(poll, 5000);
    const wake = () => document.visibilityState === "visible" && void poll();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
    };
  }, [poll]);

  return (
    <div data-bleed className="-mx-4 -my-6 flex h-[calc(100dvh-7.5rem)] overflow-hidden border-line bg-surface sm:-mx-6 md:h-[calc(100dvh-4rem)] lg:-mx-8 lg:-my-8">
      <aside className={cx("w-64 shrink-0 border-r border-line bg-surface-2/40 max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:w-72 max-md:bg-surface max-md:pb-[env(safe-area-inset-bottom)] max-md:pt-[env(safe-area-inset-top)] max-md:shadow-md", drawer ? "" : "max-md:hidden")}>
        <ChatSidebar channels={channels} current="" unread={unread} online={online} me={me} mentions={mentions} onNavigate={() => setDrawer(false)} />
      </aside>
      {drawer && <button type="button" aria-label="Close conversations" onClick={() => setDrawer(false)} className="fixed inset-0 z-30 bg-black/40 md:hidden" />}
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line px-4 py-2.5 md:hidden">
          <button type="button" onClick={() => setDrawer(true)} aria-label="Conversations" className="grid h-9 w-9 place-items-center rounded-lg text-ink-2 hover:bg-surface-2"><List aria-hidden size={18} /></button>
          <span className="font-semibold">Chat</span>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </section>
    </div>
  );
}
