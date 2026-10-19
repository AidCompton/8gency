import Link from "next/link";
import { notFound } from "next/navigation";
import { hubRequestAction } from "./actions";
import { Card, Empty, Meter, Money, StatusBadge, buttonClass } from "@/components/ui";
import { ageSince, formatShort } from "@/lib/domain/dates";
import { asContact, hubOverview, resolveHubToken } from "@/lib/services/hub";
import { firstName } from "@/lib/domain/text";

export default async function HubHome({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const contact = await resolveHubToken(token);
  if (!contact) notFound();
  const o = await asContact(contact, (tx) => hubOverview(tx, contact));
  const waitingCount = o.waiting.length + o.changes.length;
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Hi {firstName(contact.name)}{waitingCount ? `, ${waitingCount} item${waitingCount > 1 ? "s" : ""} need${waitingCount > 1 ? "" : "s"} you` : ""}</h1>
      <Card title="Waiting on you">
        {waitingCount ? (
          <ul className="divide-y divide-line">
            {o.waiting.map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-3 py-3">
                <div><div className="font-medium">{w.name}</div><div className="text-xs text-ink-2">{w.job_name} · version {w.version} · waiting {ageSince(w.sent_to_client_at)}</div></div>
                <Link href={`/hub/${token}/review/${w.id}`} className={buttonClass("primary", "sm")}>Review</Link>
              </li>
            ))}
            {o.changes.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-3">
                <div><div className="font-medium">Change request: {c.title}</div><div className="text-xs text-ink-2">{c.estimate_hours}h · <Money cents={c.price_cents} /> excl. VAT · waiting {ageSince(c.sent_at)}</div></div>
                <Link href={`/hub/${token}/change/${c.id}`} className={buttonClass("primary", "sm")}>Decide</Link>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-ink-2">Nothing needs you right now. ✓</p>}
      </Card>
      <div className="grid gap-5 md:grid-cols-2">
        <Card title="In progress">
          {o.jobs.length ? (
            <ul className="space-y-3">
              {o.jobs.map((j) => (
                <li key={j.id}>
                  <div className="flex justify-between gap-2 text-sm"><span className="font-medium">{j.name}</span><StatusBadge status={j.status} /></div>
                  <Meter value={j.done} max={j.done + j.open} compact label={j.due_date ? `Due ${formatShort(j.due_date)}` : " "} sublabel={`${j.done}/${j.done + j.open} steps`} warnAt={2} />
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-ink-3">No live jobs.</p>}
        </Card>
        {o.retainers.length > 0 && (
          <Card title="Your retainer this month">
            {o.retainers.map((r) => <Meter key={r.name} value={r.used} max={r.allocated} label={r.name} sublabel={`${r.used}h of ${r.allocated}h`} />)}
          </Card>
        )}
        <Card title="Approved and delivered">
          {o.delivered.length ? (
            <ul className="space-y-1.5 text-sm">
              {o.delivered.map((d) => <li key={d.id}><Link className="hover:underline" href={`/hub/${token}/review/${d.id}`}>{d.name}</Link> <span className="text-xs text-ink-3">· {d.job_name} · approved {d.approved_at ? formatShort(d.approved_at.toISOString().slice(0, 10)) : ""}{d.approver ? ` by ${d.approver}` : ""}</span></li>)}
            </ul>
          ) : <Empty>Nothing delivered yet.</Empty>}
        </Card>
        {o.invoices.length > 0 && (
          <Card title="Invoices">
            <ul className="space-y-1.5 text-sm">
              {o.invoices.map((i) => (
                <li key={i.id} className="flex justify-between gap-2">
                  <Link className="hover:underline" href={`/hub/${token}/invoices/${i.id}`}>{i.number}</Link>
                  <span className="flex items-center gap-2"><Money cents={i.total_cents} currency={i.currency} /><StatusBadge status={i.status} /></span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
      <Card title="Ask for something">
        <form action={hubRequestAction} className="space-y-2">
          <input type="hidden" name="token" value={token} />
          <textarea name="body" required placeholder="What do you need, and by when?" />
          <button className={buttonClass("secondary", "sm")}>Send request</button>
          <p className="text-xs text-ink-3">Your account manager confirms timing and lets you know before anything outside the agreed scope is charged.</p>
        </form>
        {o.requests.length > 0 && (
          <ul className="mt-4 space-y-1 border-t border-line pt-3 text-sm">
            {o.requests.map((r) => <li key={r.id} className="flex justify-between gap-2"><span className="truncate text-ink-2">{r.body}</span><StatusBadge status={r.status} /></li>)}
          </ul>
        )}
      </Card>
    </div>
  );
}
