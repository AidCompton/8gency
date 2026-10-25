import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { Card, Empty, PageHeader, buttonClass } from "@/components/ui";
import { joinChannelAction } from "../../_actions/chat";
import { requireUser, tenant, requireModule } from "@/lib/auth";
import { CATEGORIES } from "@/lib/domain/chat";
import { browseChannels, ensureDefaults } from "@/lib/services/chat";

export const metadata = { title: "Browse channels" };

export default async function BrowseChannelsPage() {
  const user = await requireUser();
  requireModule(user, "chat");
  const channels = await tenant(user, async (tx) => {
    await ensureDefaults(tx);
    return browseChannels(tx, user.id);
  });
  return (
    <>
      <PageHeader back={{ href: "/app/chat", label: "Chat" }} title="Browse channels" subtitle="Every public group in the agency. Join the ones you care about." actions={<Link href="/app/chat/new" className={buttonClass("primary")}>New group</Link>} />
      <div className="max-w-3xl space-y-6">
        {CATEGORIES.map((cat) => {
          const items = channels.filter((c) => c.category === cat.key);
          if (!items.length) return null;
          return (
            <section key={cat.key}>
              <h2 className="mb-2 text-sm font-semibold">{cat.label}</h2>
              <Card pad={false}>
                <ul className="divide-y divide-line">
                  {items.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                      <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-xl">{c.emoji}</span>
                      <div className="min-w-0 flex-1">
                        <Link href={`/app/chat/${c.id}`} className="font-medium hover:underline">#{c.name}</Link>
                        <div className="truncate text-sm text-ink-2">{c.topic || "No topic yet"}</div>
                        <div className="text-xs text-ink-3">{c.members} {c.members === 1 ? "member" : "members"}{c.company_name ? ` · ${c.company_name}` : ""}</div>
                      </div>
                      {c.member ? (
                        <Link href={`/app/chat/${c.id}`} className={buttonClass("ghost", "sm")}>Open</Link>
                      ) : (
                        <form action={joinChannelAction}><input type="hidden" name="id" value={c.id} /><SubmitButton className={buttonClass("secondary", "sm")}>Join</SubmitButton></form>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          );
        })}
        {!channels.length && <Empty>No public groups yet.</Empty>}
      </div>
    </>
  );
}
