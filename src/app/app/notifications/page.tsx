import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { markNotificationsReadAction } from "../_actions/settings";
import { Card, Empty, PageHeader, buttonClass } from "@/components/ui";
import { requireUser, tenant } from "@/lib/auth";

export const metadata = { title: "Inbox" };

export default async function Notifications() {
  const user = await requireUser();
  const items = await tenant(user, (tx) =>
    tx.q<{ id: string; title: string; body: string; href: string; read_at: Date | null; created_at: Date; kind: string }>(
      "select id, title, body, href, read_at, created_at, kind from notifications where user_id = $1 order by created_at desc limit 100",
      [user.id],
    ),
  );
  return (
    <>
      <PageHeader title="Inbox" subtitle="Alerts and digests for you. Urgent items first; everything else batches here." actions={
        <form action={markNotificationsReadAction}><SubmitButton className={buttonClass("secondary", "sm")}>Mark all read</SubmitButton></form>
      } />
      <Card pad={false}>
        {items.length ? (
          <ul className="divide-y divide-line">
            {items.map((n) => (
              <li key={n.id} className={`flex items-start justify-between gap-3 px-4 py-3 ${n.read_at ? "opacity-60" : ""}`}>
                <div className="min-w-0">
                  <Link href={n.href || "#"} className="font-medium hover:underline">{n.title}</Link>
                  {n.body && <div className="truncate text-sm text-ink-2">{n.body}</div>}
                  <div className="text-xs text-ink-3">{new Date(n.created_at).toLocaleString("en-ZA")}</div>
                </div>
                {!n.read_at && (
                  <form action={markNotificationsReadAction}>
                    <input type="hidden" name="id" value={n.id} />
                    <SubmitButton className={buttonClass("ghost", "sm")}>Read</SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        ) : <div className="p-4"><Empty>You're all caught up.</Empty></div>}
      </Card>
    </>
  );
}
