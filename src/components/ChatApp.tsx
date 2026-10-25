"use client";
import {
  ArrowDown, CaretDown, ChatsCircle, Compass, Gear, Hash, List, LockSimple, PaperPlaneRight, PencilSimple, Plus, Smiley, Trash, Trophy, UsersThree,
} from "@phosphor-icons/react";
import gsap from "gsap";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { addMembersAction, deleteChatAction, editChatAction, joinChannelAction, leaveChannelAction, reactChatAction, sendChatAction, updateChannelAction } from "@/app/app/_actions/chat";
import { CATEGORIES, CHANNEL_EMOJI, channelTitle, REACTIONS, tokenize, type Person } from "@/lib/domain/chat";
import type { ChatChannel, ChatMessage } from "@/lib/services/chat";
import { ChatSidebar } from "./ChatSidebar";
import { SubmitButton } from "./SubmitButton";
import { Avatar, buttonClass, cx } from "./ui";

type Member = Person & { title: string; online: boolean };

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(Date.now() - 86400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" });
}

function Body({ text, people, me }: { text: string; people: Person[]; me: string }) {
  return (
    <>
      {tokenize(text, people).map((t, i) =>
        t.t === "bold" ? <b key={i} className="font-semibold">{t.v}</b>
        : t.t === "italic" ? <i key={i}>{t.v}</i>
        : t.t === "code" ? <code key={i} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.85em]">{t.v}</code>
        : t.t === "link" ? <a key={i} href={t.v} target="_blank" rel="noopener noreferrer" className="break-all text-brand underline-offset-2 hover:underline">{t.v}</a>
        : t.t === "mention" ? <span key={i} className={cx("rounded px-0.5 font-medium", t.id === me ? "bg-warning/20 text-ink" : "bg-brand/10 text-brand")}>{t.v}</span>
        : <Fragment key={i}>{t.v}</Fragment>,
      )}
    </>
  );
}

/** A small celebration when someone gives kudos. */
function burst(from: HTMLElement | null) {
  if (!from || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const r = from.getBoundingClientRect();
  for (let i = 0; i < 16; i++) {
    const s = document.createElement("span");
    s.textContent = ["🎉", "✨", "🙌", "🏆"][i % 4];
    s.style.cssText = `position:fixed;left:${r.left + r.width / 2}px;top:${r.top}px;z-index:60;pointer-events:none;font-size:18px`;
    document.body.append(s);
    gsap.to(s, { x: (Math.random() - 0.5) * 260, y: -80 - Math.random() * 140, rotation: (Math.random() - 0.5) * 120, opacity: 0, duration: 1.1 + Math.random() * 0.4, ease: "power2.out", onComplete: () => s.remove() });
  }
}

function Message({
  m, people, me, isManager, grouped, onReact, onEdit, onDelete,
}: {
  m: ChatMessage; people: Member[]; me: string; isManager: boolean; grouped: boolean;
  onReact: (id: string, e: string) => void; onEdit: (id: string, body: string) => Promise<boolean>; onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.body);
  const [picker, setPicker] = useState(false);
  if (m.kind === "system") {
    return <div className="py-2 text-center text-xs text-ink-3"><Body text={m.body} people={people} me={me} /> · {time(m.created_at)}</div>;
  }
  const mine = m.user_id === me;
  const kudos = m.kind === "kudos";
  const author = people.find((p) => p.id === m.user_id);
  return (
    <div className={cx("group relative flex gap-3 rounded-lg px-3 hover:bg-surface-2/50", grouped ? "py-0.5" : "pt-2.5 pb-1")}>
      <div className="w-9 shrink-0">
        {!grouped ? (
          <span className="relative block">
            <Avatar name={m.user_name ?? "Former member"} />
            {author?.online && <span aria-hidden className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-good ring-2 ring-surface" />}
          </span>
        ) : (
          <span className="block pt-1 text-right text-[10px] text-ink-3 opacity-0 group-hover:opacity-100">{time(m.created_at)}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold">{m.user_name ?? "Former member"}</span>
            <span className="text-xs text-ink-3">{time(m.created_at)}</span>
          </div>
        )}
        {m.deleted ? (
          <p className="text-sm italic text-ink-3">This message was deleted.</p>
        ) : editing ? (
          <div className="mt-1 space-y-2">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} className="text-sm" autoFocus aria-label="Edit message" />
            <div className="flex gap-2">
              <button type="button" className={buttonClass("primary", "sm")} onClick={async () => (await onEdit(m.id, draft)) && setEditing(false)}>Save</button>
              <button type="button" className={buttonClass("ghost", "sm")} onClick={() => (setDraft(m.body), setEditing(false))}>Cancel</button>
            </div>
          </div>
        ) : kudos ? (
          <div className="mt-1 rounded-xl border border-brand/30 bg-gradient-to-br from-brand/15 via-brand/5 to-transparent p-3">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-brand"><Trophy aria-hidden size={14} weight="fill" /> Kudos</div>
            <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed"><Body text={m.body} people={people} me={me} /></p>
          </div>
        ) : (
          <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink">
            <Body text={m.body} people={people} me={me} />
            {m.edited && <span className="ml-1 text-xs text-ink-3">(edited)</span>}
          </p>
        )}
        {m.reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {m.reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                onClick={() => onReact(m.id, r.emoji)}
                title={r.names.join(", ")}
                aria-pressed={r.mine}
                className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors pointer-coarse:py-1.5", r.mine ? "border-brand/50 bg-brand/10 text-brand" : "border-line bg-surface text-ink-2 hover:border-ink-3/50")}
              >
                <span>{r.emoji}</span>
                <span className="tnum font-medium">{r.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {!m.deleted && !editing && (
        <div className={cx("absolute -top-3 right-3 flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5 shadow-md transition-opacity", picker ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100")}>
          {REACTIONS.slice(0, 4).map((e) => (
            <button key={e} type="button" onClick={() => onReact(m.id, e)} aria-label={`React ${e}`} className="grid h-7 w-7 place-items-center rounded-md text-base hover:bg-surface-2">{e}</button>
          ))}
          <span className="relative">
            <button type="button" onClick={() => setPicker(!picker)} aria-label="More reactions" aria-expanded={picker} className="grid h-7 w-7 place-items-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink"><Smiley aria-hidden size={16} /></button>
            {picker && (
              <span className="absolute right-0 top-8 z-10 grid w-40 grid-cols-4 gap-0.5 rounded-lg border border-line bg-surface p-1 shadow-md">
                {REACTIONS.map((e) => (
                  <button key={e} type="button" onClick={() => (onReact(m.id, e), setPicker(false))} aria-label={`React ${e}`} className="grid h-8 place-items-center rounded-md text-lg hover:bg-surface-2">{e}</button>
                ))}
              </span>
            )}
          </span>
          {mine && (
            <button type="button" onClick={() => (setDraft(m.body), setEditing(true))} aria-label="Edit message" className="grid h-7 w-7 place-items-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink"><PencilSimple aria-hidden size={15} /></button>
          )}
          {(mine || isManager) && (
            <button type="button" onClick={() => onDelete(m.id)} aria-label="Delete message" className="grid h-7 w-7 place-items-center rounded-md text-ink-3 hover:bg-critical/10 hover:text-critical-ink"><Trash aria-hidden size={15} /></button>
          )}
        </div>
      )}
    </div>
  );
}

function Composer({ channel, people, me, onSent }: { channel: ChatChannel; people: Member[]; me: string; onSent: (kudos: boolean, el: HTMLElement | null) => void }) {
  const [text, setText] = useState("");
  const [kudos, setKudos] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [pick, setPick] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const sendRef = useRef<HTMLButtonElement>(null);
  const draftKey = `8g-chat-draft:${channel.id}`;

  useEffect(() => {
    try {
      setText(localStorage.getItem(draftKey) ?? "");
    } catch {}
  }, [draftKey]);
  useEffect(() => {
    try {
      if (text) localStorage.setItem(draftKey, text);
      else localStorage.removeItem(draftKey);
    } catch {}
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  }, [text, draftKey]);

  const matches = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    return people.filter((p) => p.id !== me && (p.name.toLowerCase().startsWith(q) || p.name.toLowerCase().split(" ").some((w) => w.startsWith(q)))).slice(0, 6);
  }, [query, people, me]);

  const onChange = (v: string) => {
    setText(v);
    const caret = ref.current?.selectionStart ?? v.length;
    const m = v.slice(0, caret).match(/(?:^|\s)@([\p{L}'-]*)$/u);
    setQuery(m ? m[1] : null);
    setPick(0);
  };
  const choose = (p: Member) => {
    const el = ref.current!;
    const caret = el.selectionStart;
    const before = text.slice(0, caret).replace(/@([\p{L}'-]*)$/u, "");
    const first = p.name.split(" ")[0];
    const handle = people.filter((x) => x.name.split(" ")[0] === first).length > 1 ? p.name : first;
    const next = `${before}@${handle} ${text.slice(caret)}`;
    setText(next);
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = before.length + handle.length + 2;
    });
  };

  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError("");
    const r = await sendChatAction(channel.id, text, kudos);
    setBusy(false);
    if (r.error) return setError(r.error);
    setText("");
    onSent(kudos, sendRef.current);
    setKudos(false);
    ref.current?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (matches.length) {
      if (e.key === "ArrowDown") return (e.preventDefault(), setPick((pick + 1) % matches.length));
      if (e.key === "ArrowUp") return (e.preventDefault(), setPick((pick - 1 + matches.length) % matches.length));
      if (e.key === "Enter" || e.key === "Tab") return (e.preventDefault(), choose(matches[pick]));
      if (e.key === "Escape") return setQuery(null);
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  const where = channel.kind === "dm" ? channelTitle(channel) : `#${channel.name}`;
  return (
    <div className="relative border-t border-line p-3">
      {matches.length > 0 && (
        <ul role="listbox" aria-label="Mention someone" className="absolute bottom-full left-3 z-10 mb-1 w-72 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-md">
          {matches.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === pick}>
              <button type="button" onMouseDown={(e) => (e.preventDefault(), choose(p))} className={cx("flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm", i === pick ? "bg-brand/10" : "hover:bg-surface-2")}>
                <Avatar name={p.name} size="sm" />
                <span className="min-w-0 flex-1 truncate"><b className="font-medium">{p.name}</b> <span className="text-xs text-ink-3">{p.title}</span></span>
                {p.online && <span aria-label="online" className="h-2 w-2 rounded-full bg-good" />}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={cx("rounded-xl border bg-surface shadow-xs transition-colors focus-within:border-brand", kudos ? "border-brand/50 bg-brand/5" : "border-control-border")}>
        {kudos && <div className="flex items-center gap-1.5 px-3 pt-2 text-xs font-medium text-brand"><Trophy aria-hidden size={14} weight="fill" /> Giving kudos: @mention who you&apos;re thanking</div>}
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKey}
          rows={1}
          placeholder={kudos ? "Thank someone for something great…" : `Message ${where}`}
          aria-label={`Message ${where}`}
          className="!min-h-0 resize-none !border-0 !bg-transparent px-3 py-2.5 text-[15px] !shadow-none focus:!ring-0"
        />
        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setKudos(!kudos)}
              aria-pressed={kudos}
              title="Give kudos"
              className={cx("inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors", kudos ? "bg-brand/15 text-brand" : "text-ink-3 hover:bg-surface-2 hover:text-ink")}
            >
              <Trophy aria-hidden size={16} weight={kudos ? "fill" : "regular"} /> Kudos
            </button>
            <span className="hidden text-xs text-ink-3 sm:inline">**bold** _italic_ `code` · @ to mention · Shift+Enter for a new line</span>
          </div>
          <button ref={sendRef} type="button" onClick={() => void send()} disabled={!text.trim() || busy} aria-label="Send" className={cx(buttonClass("primary", "sm"), "!px-2.5")}>
            <PaperPlaneRight aria-hidden size={16} weight="fill" />
          </button>
        </div>
      </div>
      {error && <p role="alert" className="mt-1.5 text-xs text-critical-ink">{error}</p>}
    </div>
  );
}

function Settings({ channel, members, people, isManager, me }: { channel: ChatChannel; members: Member[]; people: Member[]; isManager: boolean; me: string }) {
  const admin = isManager || channel.created_by === me;
  const outside = people.filter((p) => !members.some((m) => m.id === p.id));
  return (
    <details className="relative">
      <summary className="grid h-9 w-9 cursor-pointer list-none place-items-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-ink [&::-webkit-details-marker]:hidden" aria-label="Group settings">
        <Gear aria-hidden size={18} />
      </summary>
      <div className="absolute right-0 top-11 z-20 w-80 space-y-4 rounded-xl border border-line bg-surface p-4 shadow-md">
        <form action={updateChannelAction} className="space-y-3">
          <input type="hidden" name="id" value={channel.id} />
          {admin && !channel.is_default && (
            <label className="block space-y-1"><span className="text-[13px] font-medium text-ink-2">Name</span><input name="name" defaultValue={channel.name} className="field-sm" /></label>
          )}
          <label className="block space-y-1"><span className="text-[13px] font-medium text-ink-2">Topic</span><input name="topic" defaultValue={channel.topic} className="field-sm" placeholder="What's this group for?" /></label>
          <fieldset>
            <legend className="mb-1 text-[13px] font-medium text-ink-2">Emoji</legend>
            <div className="flex flex-wrap gap-1">
              {CHANNEL_EMOJI.map((e) => (
                <label key={e} className="cursor-pointer">
                  <input type="radio" name="emoji" value={e} defaultChecked={e === channel.emoji} className="peer sr-only" />
                  <span className="grid h-8 w-8 place-items-center rounded-md text-lg peer-checked:bg-brand/15 peer-checked:ring-1 peer-checked:ring-brand hover:bg-surface-2">{e}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {admin && !channel.is_default && (
            <label className="flex items-center gap-2 text-sm"><input type="hidden" name="private_set" value="1" /><input type="checkbox" name="private" defaultChecked={channel.private} /> Private: members only</label>
          )}
          <SubmitButton className={buttonClass("secondary", "sm")}>Save</SubmitButton>
        </form>
        <div>
          <h4 className="mb-1.5 text-[13px] font-medium text-ink-2">Members · {members.length}</h4>
          <ul className="max-h-36 space-y-1 overflow-y-auto text-sm">
            {members.map((p) => (
              <li key={p.id} className="flex items-center gap-2"><Avatar name={p.name} size="sm" /><span className="truncate">{p.name}</span>{p.online && <span aria-label="online" className="h-2 w-2 rounded-full bg-good" />}</li>
            ))}
          </ul>
          {outside.length > 0 && (
            <form action={addMembersAction} className="mt-2 flex gap-2">
              <input type="hidden" name="id" value={channel.id} />
              <select name="members" className="field-sm" aria-label="Add someone" defaultValue="" required>
                <option value="" disabled>Add someone…</option>
                {outside.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <SubmitButton className={buttonClass("secondary", "sm")}>Add</SubmitButton>
            </form>
          )}
        </div>
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          {!(channel.is_default && channel.name === "general") && (
            <form action={leaveChannelAction}><input type="hidden" name="id" value={channel.id} /><SubmitButton className={buttonClass("ghost", "sm")}>Leave</SubmitButton></form>
          )}
          {admin && !channel.is_default && (
            <form action={updateChannelAction}>
              <input type="hidden" name="id" value={channel.id} /><input type="hidden" name="archive" value="1" />
              <SubmitButton confirm={`Archive #${channel.name}? It disappears for everyone.`} className={buttonClass("ghost", "sm") + " !text-critical-ink"}>Archive</SubmitButton>
            </form>
          )}
        </div>
      </div>
    </details>
  );
}

export function ChatApp({
  me, isManager, channel, channels, people, members, initial, lastRead, hasMore, mentions: mentions0,
}: {
  me: string; isManager: boolean; channel: ChatChannel; channels: ChatChannel[]; people: Member[]; members: Member[];
  initial: ChatMessage[]; lastRead: number; hasMore: boolean; mentions: number;
}) {
  const [list, setList] = useState(initial);
  const [more, setMore] = useState(hasMore);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [online, setOnline] = useState(new Set(people.filter((p) => p.online).map((p) => p.id)));
  const [mentions, setMentions] = useState(mentions0);
  const [drawer, setDrawer] = useState(false);
  const [below, setBelow] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const after = useRef(initial.reduce((s, m) => Math.max(s, m.seq), 0));
  const since = useRef<string | null>(null);
  const stick = useRef(true);
  const peopleNow = useMemo(() => people.map((p) => ({ ...p, online: online.has(p.id) })), [people, online]);

  const merge = useCallback((incoming: ChatMessage[]) => {
    if (!incoming.length) return;
    setList((cur) => {
      const byId = new Map(cur.map((m) => [m.id, m]));
      for (const m of incoming) byId.set(m.id, m);
      return [...byId.values()].sort((a, b) => a.seq - b.seq);
    });
  }, []);

  const poll = useCallback(async () => {
    const q = new URLSearchParams({ after: String(after.current), read: document.visibilityState === "visible" ? "1" : "0", ...(since.current ? { since: since.current } : {}) });
    const res = await fetch(`/api/chat/${channel.id}?${q}`, { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return;
    const data: { now: string; messages: ChatMessage[]; unread: Record<string, number>; mentions: number; online: string[] } = await res.json();
    since.current = data.now;
    after.current = data.messages.reduce((s, m) => Math.max(s, m.seq), after.current);
    const fresh = data.messages.filter((m) => m.user_id !== me && !list.some((x) => x.id === m.id)).length;
    if (!stick.current && fresh) setBelow((n) => n + fresh);
    merge(data.messages);
    setUnread(data.unread);
    setMentions(data.mentions);
    setOnline(new Set(data.online));
  }, [channel.id, merge, me, list]);

  useEffect(() => {
    const t = setInterval(poll, 3000);
    const wake = () => document.visibilityState === "visible" && void poll();
    document.addEventListener("visibilitychange", wake);
    return () => (clearInterval(t), document.removeEventListener("visibilitychange", wake));
  }, [poll]);

  // Open at the first unread message, else the bottom; then follow new messages while at the bottom.
  const first = useRef(true);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (first.current) {
      first.current = false;
      const marker = el.querySelector("[data-new-divider]");
      if (marker) (marker as HTMLElement).scrollIntoView({ block: "center" });
      else el.scrollTop = el.scrollHeight;
      return;
    }
    if (stick.current) el.scrollTop = el.scrollHeight;
  }, [list]);

  const onScroll = () => {
    const el = scroller.current!;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (stick.current) setBelow(0);
  };

  const loadEarlier = async () => {
    const before = list[0]?.seq;
    const res = await fetch(`/api/chat/${channel.id}/earlier?before=${before}`, { cache: "no-store" });
    if (!res.ok) return;
    const data: { messages: ChatMessage[]; more: boolean } = await res.json();
    const el = scroller.current!;
    const h = el.scrollHeight;
    stick.current = false;
    merge(data.messages);
    setMore(data.more);
    requestAnimationFrame(() => (el.scrollTop = el.scrollHeight - h));
  };

  const act = async (p: Promise<{ error?: string }>) => {
    const r = await p;
    if (r.error) alert(r.error);
    await poll();
    return !r.error;
  };

  const title = channelTitle(channel);
  const client = channel.company_id ? { id: channel.company_id, name: channel.company_name } : null;
  let lastDay = "";

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-7.5rem)] overflow-hidden border-line bg-surface sm:-mx-6 md:h-[calc(100dvh-4rem)] lg:-mx-8 lg:-my-8">
      <aside className={cx("w-64 shrink-0 border-r border-line bg-surface-2/40 max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:w-72 max-md:bg-surface max-md:shadow-md", drawer ? "" : "max-md:hidden")}>
        <ChatSidebar channels={channels} current={channel.id} unread={unread} online={online} me={me} mentions={mentions} onNavigate={() => setDrawer(false)} />
      </aside>
      {drawer && <button type="button" aria-label="Close conversations" onClick={() => setDrawer(false)} className="fixed inset-0 z-30 bg-black/40 md:hidden" />}

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line px-4 py-2.5">
          <button type="button" onClick={() => setDrawer(true)} aria-label="Conversations" className="grid h-9 w-9 place-items-center rounded-lg text-ink-2 hover:bg-surface-2 md:hidden">
            <List aria-hidden size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-1.5 truncate font-semibold">
              {channel.kind === "dm" ? <UsersThree aria-hidden size={18} className="text-ink-3" /> : <span aria-hidden>{channel.emoji}</span>}
              {channel.kind === "channel" && (channel.private ? <LockSimple aria-hidden size={14} className="text-ink-3" /> : <Hash aria-hidden size={14} className="text-ink-3" />)}
              <span className="truncate">{title}</span>
            </h1>
            <p className="truncate text-xs text-ink-3">
              {channel.kind === "dm" ? channel.people.map((p) => `${p.name}${online.has(p.id) ? " · online" : ""}`).join(", ") : channel.topic || CATEGORIES.find((c) => c.key === channel.category)?.hint}
              {client && <> · <Link href={`/app/clients/${client.id}`} className="text-brand hover:underline">{client.name}</Link></>}
            </p>
          </div>
          {channel.kind === "channel" && (
            <span className="hidden items-center gap-1 text-xs text-ink-3 sm:inline-flex" title={members.map((m) => m.name).join(", ")}>
              <UsersThree aria-hidden size={16} /> {members.length}
            </span>
          )}
          {channel.kind === "channel" && channel.member && <Settings channel={channel} members={members.map((m) => ({ ...m, online: online.has(m.id) }))} people={peopleNow} isManager={isManager} me={me} />}
        </header>

        <div ref={scroller} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto py-3" aria-live="polite" aria-relevant="additions">
          {more && (
            <div className="pb-2 text-center">
              <button type="button" onClick={() => void loadEarlier()} className={buttonClass("ghost", "sm")}><CaretDown aria-hidden size={12} className="rotate-180" /> Earlier messages</button>
            </div>
          )}
          {!list.length && (
            <div className="grid h-full place-items-center px-6 text-center">
              <div>
                <div className="text-4xl">{channel.kind === "dm" ? "👋" : channel.emoji}</div>
                <p className="mt-2 font-medium">{channel.kind === "dm" ? `This is the start of your conversation with ${title}.` : `This is the very beginning of #${channel.name}.`}</p>
                <p className="mt-1 text-sm text-ink-3">Say hello, share something good, or give someone kudos for great work.</p>
              </div>
            </div>
          )}
          {list.map((m, i) => {
            const day = dayLabel(m.created_at);
            const showDay = day !== lastDay;
            lastDay = day;
            const prev = list[i - 1];
            const grouped = !showDay && !!prev && prev.user_id === m.user_id && prev.kind === "message" && m.kind === "message" && Date.parse(m.created_at) - Date.parse(prev.created_at) < 5 * 60_000 && !(prev.seq <= lastRead && m.seq > lastRead);
            const firstNew = m.seq > lastRead && (!prev || prev.seq <= lastRead) && m.user_id !== me && lastRead > 0;
            return (
              <Fragment key={m.id}>
                {showDay && (
                  <div className="my-3 flex items-center gap-3 px-4 text-xs font-medium text-ink-3" role="separator">
                    <span className="h-px flex-1 bg-line" /> {day} <span className="h-px flex-1 bg-line" />
                  </div>
                )}
                {firstNew && (
                  <div data-new-divider className="my-2 flex items-center gap-3 px-4 text-xs font-semibold text-critical-ink" role="separator">
                    <span className="h-px flex-1 bg-critical/40" /> New <span className="h-px w-8 bg-critical/40" />
                  </div>
                )}
                <Message
                  m={m}
                  people={peopleNow}
                  me={me}
                  isManager={isManager}
                  grouped={grouped}
                  onReact={(id, e) => void act(reactChatAction(id, e))}
                  onEdit={(id, body) => act(editChatAction(id, body))}
                  onDelete={(id) => confirm("Delete this message?") && void act(deleteChatAction(id))}
                />
              </Fragment>
            );
          })}
        </div>
        {below > 0 && (
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                const el = scroller.current!;
                el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
                setBelow(0);
              }}
              className="absolute -top-12 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-xs font-medium text-brand-ink shadow-md"
            >
              <ArrowDown aria-hidden size={12} weight="bold" /> {below} new {below === 1 ? "message" : "messages"}
            </button>
          </div>
        )}

        {channel.kind === "channel" && !channel.member && (
          <div className="flex items-center justify-between gap-3 border-t border-line bg-brand/5 px-4 py-2.5 text-sm">
            <span className="text-ink-2">You&apos;re having a look at #{channel.name}. Join to see it in your sidebar.</span>
            <form action={joinChannelAction}><input type="hidden" name="id" value={channel.id} /><SubmitButton className={buttonClass("primary", "sm")}>Join</SubmitButton></form>
          </div>
        )}
        <Composer
          channel={channel}
          people={peopleNow}
          me={me}
          onSent={(kudos, el) => {
            stick.current = true;
            if (kudos) burst(el);
            void poll();
          }}
        />
      </section>
    </div>
  );
}

