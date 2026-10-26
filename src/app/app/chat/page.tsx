import { At, Compass, PencilSimpleLine, Trophy } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { openDirectAction, joinChannelAction } from "@/app/app/_actions/chat";
import { ChatShell } from "@/components/ChatShell";
import { SubmitButton } from "@/components/SubmitButton";
import { Avatar, buttonClass } from "@/components/ui";
import { requireModule, requireUser, tenant } from "@/lib/auth";
import { channelTitle } from "@/lib/domain/chat";
import { chatHome, chatPeople, ensureDefaults, touchPresence, type ChatChannel, type HomeMessage } from "@/lib/services/chat";

export const metadata = { title: "Chat" };

/** "2h ago", "Yesterday", "12 Mar": enough to tell how fresh something is. */
function ago(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)}h ago`;
  if (mins < 48 * 60) return "Yesterday";
  return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

const preview = (m: HomeMessage) => m.body.replace(/\s+/g, " ").slice(0, 110);
const label = (c: ChatChannel) => (c.kind === "dm" ? channelTitle(c) : `#${c.name}`);

function Panel({ id, title, hint, children }: { id?: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-4 rounded-xl border border-line bg-surface">
      <header className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <span className="text-xs text-ink-3">{hint}</span>}
      </header>
      {children}
    </section>
  );
}

function ChannelRow({ c, last, strong }: { c: ChatChannel; last: HomeMessage | null; strong?: boolean }) {
  return (
    <li>
      <Link href={`/app/chat/${c.id}`} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-2">
        {c.kind === "dm" ? <Avatar name={c.people[0]?.name ?? "?"} size="sm" /> : <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-surface-2 text-[15px]">{c.emoji}</span>}
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={strong ? "font-semibold" : "font-medium"}>{label(c)}</span>
            {last && <span className="text-xs text-ink-3">{ago(last.at)}</span>}
          </span>
          {last && <span className="mt-0.5 block truncate text-sm text-ink-2"><b className="font-medium text-ink">{last.author ?? "Someone"}:</b> {preview(last)}</span>}
        </span>
        {strong && c.unread > 0 && <span className="tnum mt-0.5 min-w-5 rounded-full bg-brand px-1.5 text-center text-xs font-semibold leading-5 text-brand-ink">{c.unread}<span className="sr-only"> unread</span></span>}
      </Link>
    </li>
  );
}

export default async function ChatHomePage() {
  const user = await requireUser();
  requireModule(user, "chat");
  const data = await tenant(user, async (tx) => {
    await ensureDefaults(tx);
    await touchPresence(tx, user.id);
    const home = await chatHome(tx, user.id);
    const people = (await chatPeople(tx)).filter((p) => p.id !== user.id);
    const online = (await tx.q<{ id: string }>("select id from users where active and last_seen_at > now() - interval '5 minutes'")).map((o) => o.id);
    return { home, people, online };
  });
  const { home, people, online } = data;
  const onlineSet = new Set(online);
  const hour = Number(new Date().toLocaleString("en-ZA", { hour: "numeric", hour12: false, timeZone: user.timezone }));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const dmWith = new Set(home.channels.filter((c) => c.kind === "dm").flatMap((c) => c.people.map((p) => p.id)));
  const team = [...people].sort((a, b) => Number(onlineSet.has(b.id)) - Number(onlineSet.has(a.id)) || a.name.localeCompare(b.name)).slice(0, 12);

  return (
    <ChatShell me={user.id} channels={home.channels} mentions={home.mentionCount} online={online}>
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{greeting}, {user.name.split(" ")[0]}</h1>
            <p className="mt-1 text-sm text-ink-2">
              {home.catchUp.length ? `${home.catchUp.length} conversation${home.catchUp.length === 1 ? " has" : "s have"} something new.` : "You're all caught up."}
              {home.mentionCount > 0 && <> <a href="#mentions" className="font-medium text-brand hover:underline">{home.mentionCount} mention{home.mentionCount === 1 ? "" : "s"} of you</a>.</>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/app/chat/new#direct" className={buttonClass("primary")}><PencilSimpleLine aria-hidden size={16} /> New message</Link>
            <Link href="/app/chat/new" className={buttonClass("secondary")}>New group</Link>
            <Link href="/app/chat/browse" className={buttonClass("secondary")}><Compass aria-hidden size={16} /> Browse</Link>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-5">
            {home.catchUp.length > 0 && (
              <Panel title="Catch up" hint="Most unread first">
                <ul className="divide-y divide-line">{home.catchUp.slice(0, 6).map((x) => <ChannelRow key={x.channel.id} c={x.channel} last={x.last} strong />)}</ul>
              </Panel>
            )}

            <Panel id="mentions" title="Mentions of you" hint="Last 30 days">
              {home.mentions.length ? (
                <ul className="divide-y divide-line">
                  {home.mentions.map((m) => (
                    <li key={m.id}>
                      <Link href={`/app/chat/${m.channel_id}`} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-2">
                        <Avatar name={m.author ?? "?"} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-2">
                            <span className={m.unread ? "font-semibold" : "font-medium"}>{m.author ?? "Someone"}</span>
                            <span className="text-xs text-ink-3">in {m.channel} · {ago(m.at)}</span>
                            {m.unread && <span className="rounded-full bg-warning px-1.5 text-[10px] font-semibold leading-4 text-black">New</span>}
                          </span>
                          <span className="mt-0.5 block text-sm text-ink-2">{preview(m)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="flex items-center gap-2 px-4 py-6 text-sm text-ink-3"><At aria-hidden size={16} /> Nobody has @mentioned you lately.</p>
              )}
            </Panel>

            <Panel title="Jump back in" hint="Where the conversation is">
              {home.recent.length ? (
                <ul className="divide-y divide-line">{home.recent.map((x) => <ChannelRow key={x.channel.id} c={x.channel} last={x.last} />)}</ul>
              ) : (
                <p className="px-4 py-6 text-sm text-ink-3">Nothing has been said yet. Start in #general.</p>
              )}
            </Panel>
          </div>

          <div className="space-y-5">
            <Panel title="Team" hint={`${people.filter((p) => onlineSet.has(p.id)).length} online`}>
              <ul className="divide-y divide-line">
                {team.map((p) => (
                  <li key={p.id}>
                    <form action={openDirectAction}>
                      <input type="hidden" name="people" value={p.id} />
                      <SubmitButton title={`Message ${p.name}`} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2">
                        <span className="relative shrink-0">
                          <Avatar name={p.name} size="sm" />
                          <span aria-hidden className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface ${onlineSet.has(p.id) ? "bg-good" : "bg-ink-3/40"}`} />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                        <span className="text-xs text-ink-3">{dmWith.has(p.id) ? "Open" : "Say hi"}</span>
                      </SubmitButton>
                    </form>
                  </li>
                ))}
                {!team.length && <li className="px-4 py-5 text-sm text-ink-3">Invite your team from Settings to chat with them.</li>}
              </ul>
            </Panel>

            {home.kudos.length > 0 && (
              <Panel title="Recent kudos">
                <ul className="divide-y divide-line">
                  {home.kudos.map((k) => (
                    <li key={k.id}>
                      <Link href={`/app/chat/${k.channel_id}`} className="block px-4 py-3 text-sm transition-colors hover:bg-surface-2">
                        <span className="flex items-center gap-1.5 text-xs text-ink-3"><Trophy aria-hidden size={13} weight="fill" className="text-warning" /> {k.author} · {ago(k.at)}</span>
                        <span className="mt-0.5 block text-ink-2">{preview(k)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            {home.suggestions.length > 0 && (
              <Panel title="Channels to join" hint="Open to everyone">
                <ul className="divide-y divide-line">
                  {home.suggestions.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-surface-2 text-[15px]">{c.emoji}</span>
                      <span className="min-w-0 flex-1">
                        <Link href={`/app/chat/${c.id}`} className="block truncate text-sm font-medium hover:underline">#{c.name}</Link>
                        {c.topic && <span className="block truncate text-xs text-ink-3">{c.topic}</span>}
                      </span>
                      <form action={joinChannelAction}>
                        <input type="hidden" name="id" value={c.id} />
                        <SubmitButton className={buttonClass("secondary", "sm")}>Join</SubmitButton>
                      </form>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>
        </div>
      </div>
    </ChatShell>
  );
}
