import { MagnifyingGlass } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { Avatar, Card, Empty, PageHeader, buttonClass } from "@/components/ui";
import { requireModule, requireUser, tenant } from "@/lib/auth";
import { searchMessages } from "@/lib/services/chat";

export const metadata = { title: "Search chat" };

/** The words someone searched for, picked out in each result. */
function Highlight({ text, q }: { text: string; q: string }) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0 || !q) return <>{text.slice(0, 220)}</>;
  const start = Math.max(0, i - 80);
  return (
    <>
      {start > 0 && "…"}
      {text.slice(start, i)}
      <mark className="rounded bg-warning/30 px-0.5 text-ink">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length, i + q.length + 140)}
    </>
  );
}

export default async function ChatSearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? "").trim().slice(0, 100);
  const user = await requireUser();
  requireModule(user, "chat");
  const results = q.length >= 2 ? await tenant(user, (tx) => searchMessages(tx, user.id, q)) : [];
  return (
    <>
      <PageHeader back={{ href: "/app/chat", label: "Chat" }} title="Search chat" subtitle="Messages in public groups and in the conversations you're part of." />
      <form className="mb-5 flex max-w-xl gap-2" role="search">
        <input name="q" defaultValue={q} placeholder="Search messages…" aria-label="Search messages" autoFocus />
        <button className={buttonClass("primary")}><MagnifyingGlass aria-hidden size={16} /> Search</button>
      </form>
      {q.length >= 2 && (
        <Card pad={false}>
          {results.length ? (
            <ul className="divide-y divide-line">
              {results.map((r) => (
                <li key={r.id}>
                  <Link href={`/app/chat/${r.channel_id}`} className="flex gap-3 px-4 py-3 transition-colors hover:bg-surface-2/60">
                    <Avatar name={r.user_name ?? "?"} size="sm" />
                    <span className="min-w-0">
                      <span className="block text-xs text-ink-3"><b className="font-medium text-ink-2">{r.user_name ?? "Former member"}</b> in {r.kind === "dm" ? r.channel : `${r.emoji} ${r.channel}`} · {r.created_at.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}</span>
                      <span className="mt-0.5 block text-sm text-ink-2"><Highlight text={r.body} q={q} /></span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-4"><Empty>Nothing matches “{q}”.</Empty></div>
          )}
        </Card>
      )}
    </>
  );
}
