import Link from "next/link";
import { BarList, Card, HealthBadge, Meter, Money, PageHeader, Pct, SourceNote, Stat, Table, Td } from "@/components/ui";
import { requireCap, requireUser, tenant } from "@/lib/auth";
import { formatShort } from "@/lib/domain/dates";
import { formatMoney } from "@/lib/domain/money";
import { can } from "@/lib/permissions";
import { draftWipSummary } from "@/lib/services/eightgent";
import { clientHealthScores, healthScan, lastNDays, profitability, utilisationByPerson } from "@/lib/services/pulse";

export const metadata = { title: "Pulse" };

const compact = (v: number) => formatMoney(v, "ZAR", { compact: true });

export default async function PulsePage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const user = await requireUser();
  requireCap(user, "seeMargins");
  const days = [30, 90, 180].includes(Number((await searchParams).days)) ? Number((await searchParams).days) : 90;
  const costs = can(user, "seeCostRates");
  const w = lastNDays(days, user.timezone);
  const data = await tenant(user, async (tx) => ({
    scan: await healthScan(tx, 90),
    prof: await profitability(tx, w),
    people: await utilisationByPerson(tx, w),
    health: await clientHealthScores(tx, days),
    wip: await draftWipSummary(tx),
  }));
  const { scan, prof } = data;
  return (
    <>
      <PageHeader title="Pulse" subtitle={`Profit by everything, calculated the same way for everyone. ${formatShort(w.from)} – ${formatShort(w.to)}.`}
        actions={<div className="flex gap-1 text-sm">{[30, 90, 180].map((d) => <Link key={d} href={`/app/pulse?days=${d}`} className={`rounded-full border px-3 py-1 ${d === days ? "border-brand bg-brand/10 text-brand" : "border-line text-ink-2"}`}>{d}d</Link>)}</div>} />

      <Card title="Agency Health Scan · last 90 days" className="mb-5">
        <div className="mb-4 flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <div><span className="text-3xl font-semibold tnum">{compact(scan.total)}</span> <span className="text-sm text-ink-2">leaking (scope, retainers, unbilled work, pricing)</span></div>
          <div className="text-sm text-ink-2"><b className="tnum text-critical-ink">{compact(scan.cashAtRisk)}</b> overdue</div>
          <div className="text-sm text-ink-2"><b className="tnum">{compact(scan.capacityValue)}</b> of billable capacity unused</div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {scan.findings.map((f) => (
            <Link key={f.key} href={f.href} className="rounded-lg border border-line p-3 hover:bg-surface-2">
              <div className="flex items-baseline justify-between gap-2"><span className="font-medium">{f.title}</span><span className="tnum font-semibold">{compact(f.cents)}</span></div>
              <div className="mt-1 text-xs text-ink-2">{f.detail} · {f.rows} item(s)</div>
            </Link>
          ))}
        </div>
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-ink-2">Show the detail behind each number</summary>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div><h4 className="font-medium">Given away by client</h4><ul className="text-ink-2">{scan.absorbed.map((a) => <li key={a.company_name}>{a.company_name}: {compact(a.cents)}</li>)}</ul></div>
            <div><h4 className="font-medium">Overserviced retainer months</h4><ul className="text-ink-2">{scan.overserviced.map((o) => <li key={o.retainer_name + o.starts_on}>{o.company_name} {formatShort(o.starts_on)}: {Math.round(o.overHours * 10) / 10}h over ({compact(o.cents)})</li>)}</ul></div>
            <div><h4 className="font-medium">Not invoiced in time</h4><ul className="text-ink-2">{scan.unbilled.map((u) => <li key={u.key}>{u.description}: {compact(u.amount_cents)} · {u.age_days}d</li>)}</ul></div>
            <div><h4 className="font-medium">Overdue invoices</h4><ul className="text-ink-2">{scan.overdue.map((o) => <li key={o.id}>{o.number} {o.company_name}: {compact(o.outstanding)} · {o.daysOverdue}d late</li>)}</ul></div>
          </div>
        </details>
      </Card>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Revenue" value={<Money cents={prof.totals.revenue} compact />} hint={`AGI ${compact(prof.totals.agi)}`} />
        <Stat label="Gross profit" value={<Money cents={prof.totals.profit} compact />} hint="Revenue − labour at cost − direct costs" />
        <Stat label="Margin" value={<Pct n={prof.totals.margin} />} tone={(prof.totals.margin ?? 0) < 0.25 ? "warning" : "good"} hint="Before overheads" />
        <Stat label="Pitch and internal time" value={<>{Math.round(prof.internal.hours)}h</>} hint={costs ? <>Cost <Money cents={prof.internal.labour} compact /> · not charged to clients</> : "Not charged to clients"} />
        <Stat label="Effective hourly rate" value={<Money cents={prof.totals.hours ? Math.round(prof.totals.agi / prof.totals.hours) : 0} compact />} hint={`${Math.round(prof.totals.hours)}h worked`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Profit by client (lowest margin first)">
          <BarList rows={prof.clients.map((c) => ({ label: c.name, value: c.profit, note: c.margin === null ? "" : `${Math.round(c.margin * 100)}%`, href: `/app/clients/${c.company_id}` }))} format={compact} />
          <p className="mt-3 text-xs text-ink-3">Bar = gross profit; the percentage is margin. Red bars lost money.</p>
        </Card>
        <Card title="Effective hourly rate by client">
          <BarList rows={prof.clients.filter((c) => c.ehr !== null).sort((a, b) => (a.ehr ?? 0) - (b.ehr ?? 0)).map((c) => ({ label: c.name, value: c.ehr ?? 0 }))} format={(v) => `${formatMoney(v)}/h`} />
          <p className="mt-3 text-xs text-ink-3">AGI ÷ hours worked. Exposes clients who look good but pay badly.</p>
        </Card>
        <Card title="Jobs (lowest margin first)" pad={false} className="lg:col-span-2">
          <Table head={["Job", "Client", "Model", "Hours", "Revenue", ...(costs ? ["Labour"] : []), "Margin"]}>
            {prof.jobs.slice(0, 15).map((j) => (
              <tr key={j.id}>
                <Td><Link className="hover:underline" href={`/app/jobs/${j.id}?tab=money`}><b>{j.number}</b> {j.name}</Link></Td>
                <Td className="text-ink-2">{j.company_name}</Td>
                <Td className="text-xs uppercase text-ink-3">{j.billing_model}</Td>
                <Td right>{Math.round(j.hours_win)}</Td>
                <Td right><Money cents={j.revenue} /></Td>
                {costs && <Td right><Money cents={j.labour} /></Td>}
                <Td right className={(j.margin ?? 0) < 0 ? "text-critical-ink" : ""}><Pct n={j.margin} /></Td>
              </tr>
            ))}
          </Table>
          <p className="p-3 text-xs text-ink-3">Retainer revenue is counted at client level (prorated period fees), so retainer jobs show hours and cost here but revenue on the client.</p>
        </Card>
        <Card title="Utilisation by person" id="people" className="lg:col-span-2" pad={false}>
          <Table head={["Person", "Role", "Billable / available", "Utilisation vs target", "Billable value", "Unused capacity"]}>
            {data.people.filter((p) => p.target_utilisation > 0).map((p) => (
              <tr key={p.id}>
                <Td>{p.name}</Td>
                <Td className="text-ink-2">{p.title}</Td>
                <Td right>{Math.round(p.billable)}h / {Math.round(p.available)}h</Td>
                <Td className="w-56"><Meter value={p.utilisation ?? 0} max={p.target_utilisation} compact warnAt={10} label={`target ${Math.round(p.target_utilisation * 100)}%`} sublabel={`${Math.round((p.utilisation ?? 0) * 100)}%`} /></Td>
                <Td right><Money cents={Math.round(p.value)} compact /></Td>
                <Td right>{p.gapHours ? `${Math.round(p.gapHours)}h · ${compact(p.gapValue)}` : "—"}</Td>
              </tr>
            ))}
          </Table>
          <p className="p-3 text-xs text-ink-3">Billable utilisation = billable hours ÷ available hours (contracted, Mon–Fri). Targets are set per person for fairness (TT-03). Billable value = billable hours at the rate in force on each day.</p>
        </Card>
        <Card title="Service lines">
          <BarList rows={prof.services.sort((a, b) => b.revenue - a.revenue).map((s) => ({ label: s.job_type, value: s.revenue, note: s.margin === null ? "" : `${Math.round(s.margin * 100)}%` }))} format={compact} />
        </Card>
        <Card title="Client health">
          <ul className="space-y-2 text-sm">
            {data.health.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-2">
                <Link className="hover:underline" href={`/app/clients/${h.id}`}>{h.name}</Link>
                <span className="flex items-center gap-2"><span className="tnum">{h.score ?? "—"}</span><HealthBadge band={h.band} /></span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-3">Weighted: on-time delivery 30, scope discipline 20, payment 20, approval speed 15, satisfaction 15. Missing inputs are left out, not scored as zero.</p>
        </Card>
        <Card title="Weekly WIP summary" className="lg:col-span-2">
          <pre className="whitespace-pre-wrap font-sans text-sm">{data.wip.text}</pre>
          <SourceNote sources={data.wip.sources} by={data.wip.generatedBy} />
        </Card>
      </div>
    </>
  );
}
