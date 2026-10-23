import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { createInvoiceAction } from "../_actions/billing";
import { lockTimeAction } from "../_actions/time";
import { Badge, BarList, Card, Empty, Field, Money, PageHeader, StatusBadge, Table, Tabs, Td, buttonClass, StatusIcon, Stat } from "@/components/ui";
import { requireCap, requireUser, tenant } from "@/lib/auth";
import { addDays, endOfMonth, formatShort, startOfMonth, todayIn } from "@/lib/domain/dates";
import { formatMoney } from "@/lib/domain/money";

import { debtors, listInvoices, readyToBill, wipValuation } from "@/lib/services/billing";
import { agencySettings } from "@/lib/services/core";
import { timesheetCompliance } from "@/lib/services/time";

export const metadata = { title: "Billing" };

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = (await searchParams).tab ?? "ready";
  const user = await requireUser();
  requireCap(user, "billing");
  const today = todayIn(user.timezone);
  const lastMonthEnd = addDays(startOfMonth(today), -1);
  const data = await tenant(user, async (tx) => ({
    ready: await readyToBill(tx),
    invoices: tab === "invoices" ? await listInvoices(tx) : [],
    debt: await debtors(tx),
    wip: tab === "wip" || tab === "close" ? await wipValuation(tx) : [],
    settings: await agencySettings(tx),
    compliance: tab === "close" ? await timesheetCompliance(tx, startOfMonth(lastMonthEnd), lastMonthEnd) : [],
  }));
  const byClient = new Map<string, typeof data.ready>();
  for (const i of data.ready) byClient.set(i.company_id, [...(byClient.get(i.company_id) ?? []), i]);
  const readyTotal = data.ready.reduce((s, i) => s + i.amount_cents, 0);
  const overdueReady = data.ready.filter((r) => r.overdue).length;
  const overdue = data.debt.open.filter((o) => o.daysOverdue > 0).reduce((s, o) => s + o.outstanding, 0);
  return (
    <>
      <PageHeader title="Billing" subtitle={`Rule 11: invoices go out within ${data.settings.bill_within_days} days of a milestone, month start or approval.`} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Ready to bill" value={<Money cents={readyTotal} compact />} hint={`${overdueReady} past the ${data.settings.bill_within_days}-day limit`} tone={overdueReady ? "warning" : undefined} href="/app/billing?tab=ready" />
        <Stat label="Debtors" value={<Money cents={data.debt.total} compact />} hint="Sent, not yet paid" href="/app/billing?tab=debtors" />
        <Stat label="Overdue" value={<Money cents={overdue} compact />} hint={overdue ? "Past the due date" : "Nothing overdue"} tone={overdue ? "critical" : "good"} href="/app/billing?tab=debtors" />
        <Stat label="Time locked until" value={formatShort(data.settings.time_locked_until)} hint="Month-end close" href="/app/billing?tab=close" />
      </div>
      <Tabs base="/app/billing" active={tab} tabs={[{ key: "ready", label: `Ready to bill · ${data.ready.length}` }, { key: "invoices", label: "Invoices" }, { key: "debtors", label: "Debtors" }, { key: "wip", label: "WIP" }, { key: "close", label: "Month-end close" }]} />

      {tab === "ready" && (byClient.size ? (
        <div className="space-y-4">
          {[...byClient.entries()].map(([companyId, items]) => (
            <Card key={companyId} title={<>{items[0].company_name} {items[0].po_required && <Badge tone="warning">PO required</Badge>}</>}>
              <form action={createInvoiceAction}>
                <input type="hidden" name="company_id" value={companyId} />
                <ul className="divide-y divide-line">
                  {items.map((i) => (
                    <li key={i.key} className="flex items-center gap-3 py-2 text-sm">
                      <input type="checkbox" name="item" value={i.key} defaultChecked aria-label={i.description} />
                      <span className="min-w-0 flex-1 truncate">{i.description}{i.source_type === "time" && <span className="text-ink-3"> · {i.quantity}h</span>}</span>
                      <span className={`inline-flex items-center gap-1 text-xs ${i.overdue ? "text-critical-ink" : "text-ink-3"}`}>{i.overdue && <StatusIcon tone="critical" />}waiting {i.age_days}d</span>
                      <Money cents={i.amount_cents} />
                    </li>
                  ))}
                </ul>
                <div className="mt-3"><SubmitButton className={buttonClass("primary", "sm")}>Draft invoice</SubmitButton></div>
              </form>
            </Card>
          ))}
        </div>
      ) : <Empty>Nothing waiting to be billed.</Empty>)}

      {tab === "invoices" && (
        <Card pad={false}>
          <Table head={["Invoice", "Client", "Issued", "Due", "Total", "Outstanding", "Status"]} empty="No invoices yet.">
            {data.invoices.map((i) => (
              <tr key={i.id}>
                <Td><Link className="font-medium hover:underline" href={`/app/billing/invoices/${i.id}`}>{i.number ?? "Draft"}</Link>{i.po_number && <div className="text-xs text-ink-3">PO {i.po_number}</div>}</Td>
                <Td className="text-ink-2">{i.company_name}</Td>
                <Td className="text-ink-2">{formatShort(i.issue_date)}</Td>
                <Td className={i.status === "sent" && i.due_date && i.due_date < today ? "text-critical-ink" : "text-ink-2"}>{formatShort(i.due_date)}</Td>
                <Td right><Money cents={i.total_cents} currency={i.currency} /></Td>
                <Td right><Money cents={i.status === "sent" ? i.total_cents - i.paid_cents - i.written_off : 0} currency={i.currency} /></Td>
                <Td><StatusBadge status={i.status} /></Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {tab === "debtors" && (
        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <Card title="Debtors by age"><BarList rows={data.debt.buckets.map((b) => ({ label: b.bucket === "current" ? "Not yet due" : `${b.bucket} days`, value: b.cents, negative: b.bucket !== "current" }))} format={(v) => formatMoney(v, "ZAR", { compact: true })} /></Card>
          <Card pad={false}>
            <Table head={["Invoice", "Client", "Due", "Days over", "Reminders", "Outstanding"]} empty="No open invoices.">
              {data.debt.open.sort((a, b) => b.daysOverdue - a.daysOverdue).map((o) => (
                <tr key={o.id}>
                  <Td><Link className="hover:underline" href={`/app/billing/invoices/${o.id}`}>{o.number}</Link></Td>
                  <Td>{o.company_name}</Td>
                  <Td className="text-ink-2">{formatShort(o.due_date)}</Td>
                  <Td right className={o.daysOverdue > 0 ? "text-critical-ink" : ""}>{o.daysOverdue > 0 ? o.daysOverdue : "—"}</Td>
                  <Td className="text-xs text-ink-3">auto</Td>
                  <Td right><Money cents={o.outstanding} /></Td>
                </tr>
              ))}
            </Table>
            <p className="p-3 text-xs text-ink-3">Reminders go 3 days before due, then 1, 7 and 14 days after. At 14 days the account manager is asked to step in.</p>
          </Card>
        </div>
      )}

      {tab === "wip" && (
        <Card pad={false}>
          <Table head={["Job", "Client", "Model", "Unbilled WIP"]} empty="No unbilled work in progress.">
            {data.wip.map((j) => (
              <tr key={j.id}><Td><Link className="hover:underline" href={`/app/jobs/${j.id}?tab=money`}><b>{j.number}</b> {j.name}</Link></Td><Td className="text-ink-2">{j.company_name}</Td><Td className="text-xs uppercase text-ink-3">{j.billing_model}</Td><Td right><Money cents={j.wip} /></Td></tr>
            ))}
          </Table>
          <p className="p-3 text-xs text-ink-3">Fixed fee: fee × hours progress (capped at 100%) minus milestones invoiced. T&M: unbilled billable time at snapshotted rates. Plus approved change requests not yet invoiced.</p>
        </Card>
      )}

      {tab === "close" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={`1. Timesheet compliance · ${formatShort(startOfMonth(lastMonthEnd))} – ${formatShort(lastMonthEnd)}`}>
            <ul className="space-y-1 text-sm">{data.compliance.map((c) => <li key={c.user_id} className="flex justify-between"><span>{c.name}</span><span className="tnum">{c.days_logged} days · {c.hours}h</span></li>)}</ul>
          </Card>
          <Card title="2. WIP valued">
            <p className="text-sm">Unbilled WIP: <b><Money cents={data.wip.reduce((s, j) => s + j.wip, 0)} /></b> across {data.wip.length} jobs. <Link className="text-brand hover:underline" href="/app/billing?tab=wip">Detail</Link></p>
            <p className="mt-2 text-sm">Retainer reconciliations: <Link className="text-brand hover:underline" href="/app/retainers">review each retainer</Link>.</p>
          </Card>
          <Card title="3. Export to accounting">
            <form action="/api/export/xero" method="get" className="flex flex-wrap items-end gap-2">
              <Field label="From"><input type="date" name="from" defaultValue={startOfMonth(lastMonthEnd)} /></Field>
              <Field label="To"><input type="date" name="to" defaultValue={endOfMonth(lastMonthEnd)} /></Field>
              <SubmitButton className={buttonClass("secondary", "sm")}>Download Xero invoice CSV</SubmitButton>
            </form>
            <p className="mt-2 text-xs text-ink-3">Column layout follows Xero's sales-invoice import template. Check account codes and tax types against your Xero organisation before importing.</p>
          </Card>
          <Card title="4. Lock time">
            <form action={lockTimeAction} className="flex flex-wrap items-end gap-2">
              <Field label="Lock all time up to"><input type="date" name="until" defaultValue={lastMonthEnd} /></Field>
              <SubmitButton className={buttonClass("primary", "sm")}>Lock</SubmitButton>
            </form>
            <p className="mt-2 text-xs text-ink-3">Locked time can't be added or edited. The lock is recorded in the audit log.</p>
          </Card>
        </div>
      )}
    </>
  );
}
