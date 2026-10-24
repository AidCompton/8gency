import { ArrowSquareOut } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SubmitButton } from "@/components/SubmitButton";
import { addContactAction, addContractAction, revokeContactAction, sendHubLinkAction, sendStatusReportAction, toggleOnboardingAction, updateClientAction } from "../../_actions/clients";
import { Badge, Card, Empty, Field, HealthBadge, LinkButton, Meter, Money, PageHeader, SourceNote, StatusBadge, Table, Tabs, Td, buttonClass, TextLink, StatusIcon } from "@/components/ui";
import { requireCap, requireUser, tenant } from "@/lib/auth";
import { formatDate } from "@/lib/domain/dates";
import { can } from "@/lib/permissions";
import { onboardingProgress } from "@/lib/services/agency";
import { appUrl } from "@/lib/services/core";
import { draftStatusReport } from "@/lib/services/eightgent";
import { clientHealthScores, profitability, lastNDays } from "@/lib/services/pulse";
import { listRetainers } from "@/lib/services/retainers";

export const metadata = { title: "Client" };

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const tab = (await searchParams).tab ?? "overview";
  const user = await requireUser();
  requireCap(user, "seeAllJobs");
  const money = can(user, "seeMargins");
  const data = await tenant(user, async (tx) => {
    const c = await tx.one<{ id: string; name: string; code: string; status: string; po_required: boolean; payment_terms_days: number; billing_email: string; account_manager_id: string | null; satisfaction: number | null; currency: string; created_at: Date }>(
      "select * from companies where id = $1",
      [id],
    );
    if (!c) return null;
    return {
      c,
      contacts: await tx.q<{ id: string; name: string; email: string; phone: string; role: string; active: boolean; hub_token: string | null }>("select id, name, email, phone, role, active, hub_token from contacts where company_id = $1 order by active desc, role, name", [id]),
      jobs: await tx.q<{ id: string; number: string; name: string; status: string; due_date: string | null }>("select id, number, name, status, due_date from jobs where company_id = $1 order by status = 'closed', due_date desc nulls last limit 30", [id]),
      retainers: await listRetainers(tx, id),
      crs: await tx.q<{ id: string; title: string; status: string; price_cents: number; created_at: Date; absorb_reason: string | null; decided_by: string | null }>("select id, title, status, price_cents, created_at, absorb_reason, decided_by from change_requests where company_id = $1 order by created_at desc", [id]),
      health: (await clientHealthScores(tx)).find((h) => h.id === id),
      onboarding: await onboardingProgress(tx, id),
      contracts: await tx.q<{ id: string; kind: string; title: string; starts_on: string | null; ends_on: string | null; renewal_on: string | null; notice_days: number; signed_at: Date | null; signed_by: string | null; ip_terms: string; supersedes_id: string | null }>("select * from contracts where company_id = $1 order by created_at desc", [id]),
      users: await tx.q<{ id: string; name: string }>("select id, name from users where active order by name"),
      prof: money ? (await profitability(tx, lastNDays(90, user.timezone))).clients.find((x) => x.company_id === id) : undefined,
      draft: tab === "report" ? await draftStatusReport(tx, id) : null,
    };
  });
  if (!data) notFound();
  const { c } = data;
  const base = `/app/clients/${id}`;
  return (
    <>
      <PageHeader
        back={{ href: "/app/clients", label: "Clients" }}
        title={<span className="flex items-center gap-2">{c.name} <StatusBadge status={c.status} /></span>}
        subtitle={<>{c.code} · {c.payment_terms_days}-day terms{c.po_required ? " · PO required on invoices" : ""} · client since {formatDate(c.created_at.toISOString().slice(0, 10))}</>}
        actions={can(user, "manageJobs") && <LinkButton href={`/app/jobs/new?company=${id}`} variant="primary">New job</LinkButton>}
      />
      <Tabs base={base} active={tab} tabs={[
        { key: "overview", label: "Overview" },
        { key: "onboarding", label: `Onboarding · ${Math.round(data.onboarding.pct * 100)}%` },
        { key: "contracts", label: "Contracts" },
        { key: "report", label: "Status update" },
        ...(can(user, "manageJobs") ? [{ key: "settings", label: "Settings" }] : []),
      ]} />

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Contacts and hub access" className="lg:col-span-2">
            {data.contacts.length ? (
              <ul className="divide-y divide-line">
                {data.contacts.map((p) => (
                  <li key={p.id} className={`flex flex-wrap items-center justify-between gap-2 py-2.5 ${p.active ? "" : "opacity-50"}`}>
                    <div>
                      <div className="font-medium">{p.name} <Badge tone={p.role === "approver" ? "brand" : "neutral"}>{p.role}</Badge>{!p.active && <Badge>access revoked</Badge>}</div>
                      <div className="text-xs text-ink-2">{[p.email, p.phone].filter(Boolean).join(" · ")}</div>
                    </div>
                    {p.active && can(user, "manageJobs") && (
                      <div className="flex gap-2">
                        {p.hub_token && <a className={buttonClass("ghost", "sm")} href={appUrl(`/hub/${p.hub_token}`)} target="_blank" rel="noopener">Open hub <ArrowSquareOut aria-hidden size={14} /><span className="sr-only"> (opens in a new tab)</span></a>}
                        <form action={sendHubLinkAction}><input type="hidden" name="company_id" value={id} /><input type="hidden" name="contact_id" value={p.id} /><SubmitButton className={buttonClass("secondary", "sm")}>Send hub link</SubmitButton></form>
                        <form action={revokeContactAction}><input type="hidden" name="company_id" value={id} /><input type="hidden" name="contact_id" value={p.id} /><SubmitButton className={buttonClass("danger", "sm")}>Revoke</SubmitButton></form>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : <Empty>No contacts yet. Add at least one approver before anything goes to review.</Empty>}
            {can(user, "manageJobs") && (
              <form action={addContactAction} className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
                <input type="hidden" name="company_id" value={id} />
                <Field label="Name"><input name="name" required /></Field>
                <Field label="Email"><input name="email" type="email" /></Field>
                <Field label="WhatsApp"><input name="phone" type="tel" /></Field>
                <Field label="Role"><select name="role" defaultValue="approver"><option value="approver">Approver</option><option value="commenter">Commenter</option><option value="billing">Billing</option><option value="legal">Legal</option></select></Field>
                <SubmitButton className={buttonClass("secondary", "sm") + " justify-self-start sm:col-span-2"}>Add contact</SubmitButton>
              </form>
            )}
          </Card>
          <Card title="Health">
            {data.health && data.health.score !== null ? (
              <>
                <div className="mb-3 flex items-center gap-2"><span className="text-3xl font-semibold tnum">{data.health.score}</span><HealthBadge band={data.health.band} /></div>
                <ul className="space-y-1.5 text-sm">
                  {data.health.parts.map((p) => (
                    <li key={p.key} className="flex justify-between"><span className="text-ink-2">{p.key}</span><span className="tnum">{p.value === null ? "no data" : `${Math.round(p.value * 100)}`}</span></li>
                  ))}
                </ul>
              </>
            ) : <p className="text-sm text-ink-3">Not enough history yet.</p>}
            {data.prof && (
              <div className="mt-4 border-t border-line pt-3 text-sm">
                <div className="flex justify-between gap-3"><span className="text-ink-2">Revenue, 90 days</span><Money cents={data.prof.revenue} /></div>
                <div className="flex justify-between gap-3"><span className="text-ink-2">Margin</span><span className="tnum">{data.prof.margin === null ? "—" : `${Math.round(data.prof.margin * 100)}%`}</span></div>
                <div className="flex justify-between gap-3"><span className="text-ink-2">Effective hourly rate</span><Money cents={data.prof.ehr} /></div>
              </div>
            )}
          </Card>
          <Card title="Jobs" className="lg:col-span-2" pad={false}>
            <Table head={["Job", "Status", "Due"]} empty="No jobs yet.">
              {data.jobs.map((j) => (
                <tr key={j.id}><Td><Link className="hover:underline" href={`/app/jobs/${j.id}`}><b>{j.number}</b> {j.name}</Link></Td><Td><StatusBadge status={j.status} /></Td><Td className="text-ink-2">{formatDate(j.due_date)}</Td></tr>
              ))}
            </Table>
          </Card>
          <div className="space-y-4">
            {data.retainers.map((r) => (
              <Card key={r.retainer.id} title={r.retainer.name}>
                <Meter value={r.usedHours} max={r.allocated} label="This month" sublabel={`${r.usedHours}h / ${r.allocated}h`} marker={r.burn?.elapsed} markerLabel="month elapsed" />
                <TextLink className="mt-2" href={`/app/retainers/${r.retainer.id}`}>Retainer</TextLink>
              </Card>
            ))}
            <Card title="Scope-change log">
              {data.crs.length ? (
                <ul className="space-y-2 text-sm">
                  {data.crs.map((cr) => (
                    <li key={cr.id}>
                      <div className="flex justify-between gap-2"><Link href={`/app/scope/${cr.id}`} className="truncate hover:underline">{cr.title}</Link><StatusBadge status={cr.status} /></div>
                      <div className="text-xs text-ink-3"><Money cents={cr.price_cents} visible={money} />{cr.absorb_reason ? ` · absorbed: ${cr.absorb_reason}` : cr.decided_by ? ` · ${cr.decided_by}` : ""}</div>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-ink-3">No changes to scope yet.</p>}
            </Card>
          </div>
        </div>
      )}

      {tab === "onboarding" && (
        <Card title={`Onboarding: ${data.onboarding.done} of ${data.onboarding.total} done`} className="max-w-3xl">
          <Meter value={data.onboarding.done} max={data.onboarding.total} warnAt={2} />
          <ul className="mt-4 divide-y divide-line">
            {data.onboarding.items.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 py-2.5">
                <div>
                  <div className={i.done_at ? "text-ink-3 line-through" : ""}>{i.label}</div>
                  <div className="text-xs text-ink-3">{i.client_facing ? "Client completes via hub" : "Internal"}{i.done_at ? ` · done by ${i.done_by}` : ""}</div>
                </div>
                <form action={toggleOnboardingAction}><input type="hidden" name="company_id" value={id} /><input type="hidden" name="item_id" value={i.id} /><SubmitButton className={buttonClass(i.done_at ? "ghost" : "secondary", "sm")}>{i.done_at ? "Undo" : "Mark done"}</SubmitButton></form>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-3">Clients see their outstanding items in the hub. 8gency schedules 30-, 60- and 90-day check-ins automatically.</p>
        </Card>
      )}

      {tab === "contracts" && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card pad={false}>
            <Table head={["Contract", "Term", "Renewal / notice", "Signed"]} empty="No contracts on file.">
              {data.contracts.map((k) => (
                <tr key={k.id}>
                  <Td><b>{k.title}</b> <Badge>{k.kind.toUpperCase()}</Badge>{k.supersedes_id && <Badge tone="info">amendment</Badge>}{k.ip_terms && <div className="text-xs text-ink-2">IP: {k.ip_terms}</div>}</Td>
                  <Td className="text-ink-2">{formatDate(k.starts_on)} – {formatDate(k.ends_on)}</Td>
                  <Td className="text-ink-2">{formatDate(k.renewal_on)} · {k.notice_days}d notice</Td>
                  <Td>{k.signed_at ? <span className="inline-flex items-center gap-1 text-good-ink"><StatusIcon tone="good" /> Signed · {k.signed_by}</span> : <Badge tone="warning">unsigned</Badge>}</Td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card title="Record a contract">
            <form action={addContractAction} className="space-y-2">
              <input type="hidden" name="company_id" value={id} />
              <Field label="Title"><input name="title" placeholder="e.g. Master services agreement 2026" required /></Field>
              <Field label="Type"><select name="kind"><option value="msa">MSA</option><option value="sow">SOW</option><option value="nda">NDA</option><option value="other">Other</option></select></Field>
              <div className="grid grid-cols-2 gap-2"><Field label="Starts"><input type="date" name="starts_on" /></Field><Field label="Ends"><input type="date" name="ends_on" /></Field></div>
              <div className="grid grid-cols-2 gap-2"><Field label="Renewal"><input type="date" name="renewal_on" /></Field><Field label="Notice days"><input name="notice_days" defaultValue="30" /></Field></div>
              <Field label="IP and ownership terms"><input name="ip_terms" /></Field>
              <Field label="Amends (signed contracts are never edited)"><select name="supersedes_id" defaultValue=""><option value="">—</option>{data.contracts.filter((k) => k.signed_at).map((k) => <option key={k.id} value={k.id}>{k.title}</option>)}</select></Field>
              <label className="flex items-center gap-2"><input type="checkbox" name="signed" /> Signed</label>
              <Field label="Signed by"><input name="signed_by" /></Field>
              <SubmitButton className={buttonClass("secondary", "sm")}>Save</SubmitButton>
              <p className="text-xs text-ink-3">Renewals and end dates trigger reminders 90, 60 and 30 days ahead.</p>
            </form>
          </Card>
        </div>
      )}

      {tab === "report" && data.draft && (
        <Card title="Weekly status update" className="max-w-3xl">
          <form action={sendStatusReportAction} className="space-y-3">
            <input type="hidden" name="company_id" value={id} />
            <textarea name="body" aria-label="Status update" defaultValue={data.draft.text} className="min-h-[360px] font-mono text-sm" />
            <SourceNote sources={data.draft.sources} by={data.draft.generatedBy} />
            {can(user, "sendChangeRequests") && <SubmitButton className={buttonClass("primary", "sm")}>Send to client contacts</SubmitButton>}
          </form>
        </Card>
      )}

      {tab === "settings" && can(user, "manageJobs") && (
        <Card title="Client settings" className="max-w-2xl">
          <form action={updateClientAction} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="company_id" value={id} />
            <Field label="Name" className="sm:col-span-2"><input name="name" defaultValue={c.name} /></Field>
            <Field label="Status"><select name="status" defaultValue={c.status}>{["onboarding", "active", "paused", "former"].map((s) => <option key={s}>{s}</option>)}</select></Field>
            <Field label="Account manager"><select name="account_manager_id" defaultValue={c.account_manager_id ?? ""}><option value="">—</option>{data.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
            <Field label="Payment terms (days)"><input name="payment_terms_days" defaultValue={c.payment_terms_days} /></Field>
            <Field label="Billing currency"><input name="currency" defaultValue={c.currency} maxLength={3} /></Field>
            <Field label="Billing email"><input name="billing_email" defaultValue={c.billing_email} /></Field>
            <Field label="Satisfaction (1–5, latest)"><input name="satisfaction" defaultValue={c.satisfaction ?? ""} /></Field>
            <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" name="po_required" defaultChecked={c.po_required} /> Requires a PO number on invoices</label>
            <div><SubmitButton className={buttonClass("secondary", "sm")}>Save</SubmitButton></div>
          </form>
          <p className="mt-4 text-xs text-ink-3">Marking a client “former” doesn’t revoke hub links. Revoke each contact on the overview tab the day they leave.</p>
        </Card>
      )}
    </>
  );
}
