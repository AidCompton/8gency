import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { dismissRequestAction, triageChangeAction, triageTaskAction } from "../_actions/scope";
import { BarList, Badge, Card, Empty, Money, PageHeader, StatusBadge, Table, Tabs, Td, buttonClass, Field, Stat } from "@/components/ui";
import { requireCap, requireUser, tenant } from "@/lib/auth";
import { ageSince } from "@/lib/domain/dates";
import { formatMoney } from "@/lib/domain/money";
import { summarise } from "@/lib/domain/text";
import { can } from "@/lib/permissions";

export const metadata = { title: "Scope Guard" };

export default async function ScopePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = (await searchParams).tab ?? "triage";
  const user = await requireUser();
  requireCap(user, "triage");
  const money = can(user, "seeMargins");
  const data = await tenant(user, async (tx) => ({
    requests: await tx.q<{ id: string; body: string; channel: string; oos_score: number; oos_signals: string[]; created_at: Date; company_id: string; company_name: string; contact: string | null; job_id: string | null }>(
      `select r.id, r.body, r.channel, r.oos_score, r.oos_signals, r.created_at, r.company_id, c.name as company_name, ct.name as contact, r.job_id
         from client_requests r join companies c on c.id = r.company_id left join contacts ct on ct.id = r.contact_id where r.status = 'new' order by r.oos_score desc, r.created_at`,
    ),
    jobScopes: await tx.q<{ company_id: string; job_id: string; number: string; scope_id: string; scope_name: string }>(
      `select j.company_id, j.id as job_id, j.number, s.id as scope_id, s.name as scope_name
         from jobs j join scope_items s on s.job_id = j.id where j.status not in ('closed','complete') order by j.number, s.created_at`,
    ),
    users: await tx.q<{ id: string; name: string }>("select id, name from users where active order by name"),
    changes: await tx.q<{ id: string; title: string; status: string; price_cents: number; estimate_hours: number; company_name: string; job_number: string | null; origin: string; sent_at: Date | null; created_at: Date }>(
      `select cr.id, cr.title, cr.status, cr.price_cents, cr.estimate_hours, c.name as company_name, j.number as job_number, cr.origin, cr.sent_at, cr.created_at
         from change_requests cr join companies c on c.id = cr.company_id left join jobs j on j.id = cr.job_id
        where cr.status <> 'absorbed' order by case cr.status when 'draft' then 0 when 'sent' then 1 else 2 end, cr.created_at desc limit 100`,
    ),
    absorbed: await tx.q<{ id: string; title: string; price_cents: number; company_name: string; absorb_reason: string; decided_by: string; decided_at: Date }>(
      `select cr.id, cr.title, cr.price_cents, c.name as company_name, cr.absorb_reason, cr.decided_by, cr.decided_at
         from change_requests cr join companies c on c.id = cr.company_id where cr.status = 'absorbed' order by cr.decided_at desc limit 200`,
    ),
    absorbedByMonth: await tx.q<{ month: string; company_name: string; cents: number }>(
      `select to_char(date_trunc('month', cr.decided_at), 'Mon YYYY') as month, c.name as company_name, sum(cr.price_cents) as cents
         from change_requests cr join companies c on c.id = cr.company_id where cr.status = 'absorbed' and cr.decided_at > now() - interval '6 months'
        group by 1, 2, date_trunc('month', cr.decided_at) order by date_trunc('month', cr.decided_at) desc, 3 desc`,
    ),
    won: (await tx.one<{ v: number }>("select coalesce(sum(price_cents),0) as v from change_requests where status = 'approved' and decided_at > now() - interval '90 days'"))!.v,
  }));
  const absorbedTotal = data.absorbed.reduce((s, a) => s + a.price_cents, 0);
  return (
    <>
      <PageHeader title="Scope Guard" subtitle="New client requests are triaged here — never straight onto someone's list. Out-of-scope work becomes a priced change request, or is absorbed on the record." />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Stat label="To triage" value={data.requests.length} hint={data.requests.length ? "New client requests" : "Inbox zero"} />
        <Stat label="Recovered, 90 days" value={<Money cents={data.won} visible={money} compact />} hint="Approved change requests" tone="good" />
        <Stat label="Given away" value={<Money cents={absorbedTotal} visible={money} compact />} hint="Absorbed, all time" tone={absorbedTotal > 0 ? "warning" : undefined} />
      </div>
      <Tabs base="/app/scope" active={tab} tabs={[{ key: "triage", label: `Triage · ${data.requests.length}` }, { key: "changes", label: "Change requests" }, { key: "absorbed", label: "Absorbed" }]} />

      {tab === "triage" && (data.requests.length ? (
        <ul className="space-y-3">
          {data.requests.map((r) => {
            const options = data.jobScopes.filter((j) => j.company_id === r.company_id);
            const jobs = [...new Map(options.map((o) => [o.job_id, o])).values()];
            return (
              <li key={r.id} className="rounded-xl border border-line bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="text-xs text-ink-3"><b className="text-ink-2">{r.company_name}</b> · {r.contact ?? "staff"} via {r.channel} · {ageSince(r.created_at)} ago</div>
                  {r.oos_score >= 30 ? <Badge tone="critical" dot>Possibly out of scope ({r.oos_score})</Badge> : <Badge tone="good" dot>Looks in scope</Badge>}
                </div>
                <p className="mt-2 whitespace-pre-wrap">{r.body}</p>
                {r.oos_signals.length > 0 && <p className="mt-1 text-xs text-ink-2">8gent flagged: {r.oos_signals.join(", ")}</p>}
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <form action={triageTaskAction} className="space-y-2 rounded-lg bg-surface-2 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">In scope → task</div>
                    <input type="hidden" name="request_id" value={r.id} />
                    <Field label="Task title"><input name="title" defaultValue={summarise(r.body)} /></Field>
                    <Field label="Job and scope item">
                      <select name="job_scope" required defaultValue="">
                        <option value="" disabled>Choose…</option>
                        {options.map((o) => <option key={o.scope_id} value={`${o.job_id}:${o.scope_id}`}>{o.number} · {o.scope_name}</option>)}
                      </select>
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Assignee"><select name="assignee_id" defaultValue=""><option value="">Unassigned</option>{data.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
                      <Field label="Due"><input type="date" name="due_date" /></Field>
                    </div>
                    <SubmitButton className={buttonClass("secondary", "sm")}>Accept as in-scope</SubmitButton>
                  </form>
                  <form action={triageChangeAction} className="space-y-2 rounded-lg bg-surface-2 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">Out of scope → change request</div>
                    <input type="hidden" name="request_id" value={r.id} />
                    <Field label="Change request title"><input name="title" defaultValue={summarise(r.body)} /></Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Job"><select name="job_id" defaultValue={r.job_id ?? ""}><option value="">No specific job</option>{jobs.map((o) => <option key={o.job_id} value={o.job_id}>{o.number}</option>)}</select></Field>
                      <Field label="Estimated hours"><input name="estimate_hours" inputMode="decimal" /></Field>
                    </div>
                    <div className="flex gap-2">
                      <SubmitButton className={buttonClass("primary", "sm")}>Draft change request</SubmitButton>
                      <SubmitButton formAction={dismissRequestAction} className={buttonClass("ghost", "sm")}>Dismiss</SubmitButton>
                    </div>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      ) : <Empty>Nothing to triage. New requests from the hub, email and WhatsApp land here.</Empty>)}

      {tab === "changes" && (
        <Card pad={false}>
          <Table head={["Change request", "Client", "Origin", "Hours", "Price", "Status", "Waiting"]} empty="No change requests yet.">
            {data.changes.map((c) => (
              <tr key={c.id}>
                <Td><Link className="font-medium hover:underline" href={`/app/scope/${c.id}`}>{c.title}</Link>{c.job_number && <div className="text-xs text-ink-3">{c.job_number}</div>}</Td>
                <Td className="text-ink-2">{c.company_name}</Td>
                <Td className="text-xs text-ink-2">{c.origin.replace("_", " ")}</Td>
                <Td right>{c.estimate_hours}</Td>
                <Td right><Money cents={c.price_cents} visible={money} /></Td>
                <Td><StatusBadge status={c.status} /></Td>
                <Td className="text-xs text-ink-3">{c.status === "sent" && c.sent_at ? ageSince(c.sent_at) : c.status === "draft" ? `draft ${ageSince(c.created_at)}` : ""}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {tab === "absorbed" && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card pad={false}>
            <Table head={["Absorbed work", "Client", "Value", "Reason", "By"]} empty="Nothing absorbed. Good.">
              {data.absorbed.map((a) => (
                <tr key={a.id}>
                  <Td><Link className="hover:underline" href={`/app/scope/${a.id}`}>{a.title}</Link></Td>
                  <Td className="text-ink-2">{a.company_name}</Td>
                  <Td right><Money cents={a.price_cents} visible={money} /></Td>
                  <Td className="text-sm text-ink-2">{a.absorb_reason}</Td>
                  <Td className="text-xs text-ink-3">{a.decided_by}</Td>
                </tr>
              ))}
            </Table>
          </Card>
          {money && (
            <Card title="Given away by client and month">
              {data.absorbedByMonth.length ? (
                <BarList rows={data.absorbedByMonth.map((r) => ({ label: `${r.month} · ${r.company_name}`, value: r.cents }))} format={(v) => formatMoney(v, "ZAR", { compact: true })} />
              ) : <p className="text-sm text-ink-3">Nothing in the last 6 months.</p>}
            </Card>
          )}
        </div>
      )}
    </>
  );
}
