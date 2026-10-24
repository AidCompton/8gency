import { Info } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import type { ReactNode } from "react";
import { Card, HealthBadge, Meter, Money, PageHeader, Pct, SourceNote, Stat, Table, Tabs, Td, cx } from "@/components/ui";
import { requireCap, requireUser, tenant } from "@/lib/auth";
import { formatShort } from "@/lib/domain/dates";
import { formatMoney } from "@/lib/domain/money";
import { can } from "@/lib/permissions";
import { draftWipSummary } from "@/lib/services/eightgent";
import { clientHealthScores, healthScan, lastNDays, profitability, utilisationByPerson } from "@/lib/services/pulse";

export const metadata = { title: "Pulse" };

const compact = (v: number) => formatMoney(v, "ZAR", { compact: true });
/** Hourly rates read better in whole rands. */
const perHour = (cents: number) => `R${Math.round(cents / 100).toLocaleString("en-ZA")}`;
const VIEWS = ["overview", "clients", "jobs", "people"] as const;
type View = (typeof VIEWS)[number];

/** Footnotes stay out of the way until someone asks how a number is worked out. */
function HowCalculated({ children }: { children: ReactNode }) {
  return (
    <details className="group mt-4 text-sm">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded text-ink-3 hover:text-ink pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
        <Info aria-hidden size={14} /> How this is calculated
      </summary>
      <div className="mt-2 max-w-3xl space-y-1 text-xs leading-relaxed text-ink-3">{children}</div>
    </details>
  );
}

const marginTone = (m: number | null) => (m === null ? "text-ink-3" : m < 0 ? "font-medium text-critical-ink" : m < 0.25 ? "text-warning-ink" : "text-ink");

export default async function PulsePage({ searchParams }: { searchParams: Promise<{ days?: string; tab?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  requireCap(user, "seeMargins");
  const days = [30, 90, 180].includes(Number(sp.days)) ? Number(sp.days) : 90;
  // Same "tab" parameter as the shared <Tabs> component builds.
  const view: View = VIEWS.includes(sp.tab as View) ? (sp.tab as View) : "overview";
  const costs = can(user, "seeCostRates");
  const w = lastNDays(days, user.timezone);
  const data = await tenant(user, async (tx) => ({
    scan: view === "overview" ? await healthScan(tx, 90) : null,
    prof: await profitability(tx, w),
    people: view === "people" ? await utilisationByPerson(tx, w) : [],
    health: view === "clients" ? await clientHealthScores(tx, days) : [],
    wip: view === "overview" ? await draftWipSummary(tx) : null,
  }));
  const { prof } = data;
  const t = prof.totals;
  const health = new Map(data.health.map((h) => [h.id, h]));

  return (
    <>
      <PageHeader
        title="Pulse"
        subtitle={`How the agency is really doing: profit by client, job and person. ${formatShort(w.from)} – ${formatShort(w.to)}.`}
        actions={
          <div role="group" aria-label="Period" className="inline-flex rounded-lg border border-line bg-surface p-0.5 shadow-xs">
            {[30, 90, 180].map((d) => (
              <Link
                key={d}
                href={`/app/pulse?days=${d}&tab=${view}`}
                aria-current={d === days ? "true" : undefined}
                className={cx("rounded-md px-3 py-1 text-sm font-medium transition-colors pointer-coarse:py-2.5", d === days ? "bg-brand/10 text-brand" : "text-ink-3 hover:text-ink")}
              >
                {d} days
              </Link>
            ))}
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Revenue" value={<Money cents={t.revenue} compact />} hint={`${Math.round(t.hours)}h worked`} />
        <Stat label="Gross profit" value={<Money cents={t.profit} compact />} hint="After people and costs" />
        <Stat label="Margin" value={<Pct n={t.margin} />} hint="Before overheads" tone={(t.margin ?? 0) < 0.25 ? "warning" : "good"} />
        <Stat label="Earned per hour" value={perHour(t.hours ? t.agi / t.hours : 0)} hint="Across all client work" />
      </div>

      <Tabs
        base={`/app/pulse?days=${days}`}
        active={view}
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "clients", label: `Clients · ${prof.clients.length}` },
          { key: "jobs", label: `Jobs · ${prof.jobs.length}` },
          { key: "people", label: "People" },
        ]}
      />

      {view === "overview" && data.scan && (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Card title="Where money is leaking · last 90 days" pad={false}>
            <div className="flex flex-wrap items-end gap-x-8 gap-y-2 border-b border-line px-4 py-4">
              <div>
                <div className="text-3xl font-semibold tracking-tight tnum">{compact(data.scan.total)}</div>
                <div className="text-sm text-ink-2">lost to scope, retainers, unbilled work and pricing</div>
              </div>
              <div className="text-sm text-ink-2">
                <b className="tnum font-semibold text-critical-ink">{compact(data.scan.cashAtRisk)}</b> overdue
              </div>
              <div className="text-sm text-ink-2">
                <b className="tnum font-semibold text-ink">{compact(data.scan.capacityValue)}</b> of billable time unused
              </div>
            </div>
            <ul className="divide-y divide-line">
              {data.scan.findings.map((f) => (
                <li key={f.key}>
                  <Link href={f.href} className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-surface-2/60">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{f.title}</span>
                      <span className="block truncate text-xs text-ink-3">{f.detail}</span>
                    </span>
                    <span className="tnum shrink-0 text-sm font-semibold">{compact(f.cents)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <div className="space-y-4">
            <Card title="Revenue by service">
              <ul className="space-y-3">
                {prof.services
                  .sort((a, b) => b.revenue - a.revenue)
                  .map((s) => (
                    <li key={s.job_type} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate capitalize text-ink-2">{s.job_type.replace(/_/g, " ")}</span>
                      <span className="shrink-0">
                        <span className="tnum font-medium">{compact(s.revenue)}</span>
                        {s.margin !== null && <span className={cx("tnum ml-2 text-xs", marginTone(s.margin))}>{Math.round(s.margin * 100)}%</span>}
                      </span>
                    </li>
                  ))}
              </ul>
            </Card>
            {data.wip && (
              <Card>
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
                    This week&apos;s WIP summary
                    <span className="text-xs font-medium text-brand group-open:hidden">Read</span>
                    <span className="hidden text-xs font-medium text-brand group-open:inline">Hide</span>
                  </summary>
                  <pre className="mt-3 whitespace-pre-wrap font-sans text-sm text-ink-2">{data.wip.text}</pre>
                  <SourceNote sources={data.wip.sources} by={data.wip.generatedBy} />
                </details>
              </Card>
            )}
          </div>
        </div>
      )}

      {view === "clients" && (
        <Card pad={false}>
          <Table head={["Client", "Revenue", "Gross profit", "Margin", "Earned per hour", "Health"]} empty="No client work in this period.">
            {prof.clients.map((c) => {
              const h = health.get(c.company_id);
              return (
                <tr key={c.company_id}>
                  <Td><Link className="font-medium hover:underline" href={`/app/clients/${c.company_id}`}>{c.name}</Link></Td>
                  <Td right><Money cents={c.revenue} compact /></Td>
                  <Td right className={c.profit < 0 ? "text-critical-ink" : ""}><Money cents={c.profit} compact /></Td>
                  <Td right className={marginTone(c.margin)}><Pct n={c.margin} /></Td>
                  <Td right>{c.ehr === null ? "—" : `${perHour(c.ehr)}/h`}</Td>
                  <Td>{h && h.score !== null ? <span className="inline-flex items-center gap-2"><span className="tnum text-ink-2">{h.score}</span><HealthBadge band={h.band} /></span> : <span className="text-ink-3">—</span>}</Td>
                </tr>
              );
            })}
          </Table>
          <div className="px-4 pb-4">
            <HowCalculated>
              <p>Lowest margin first. Gross profit = revenue − people at cost − direct costs. Earned per hour = agency gross income ÷ hours worked, which exposes clients who look good but pay badly.</p>
              <p>Health weighs on-time delivery (30), scope discipline (20), payment (20), approval speed (15) and satisfaction (15). Missing inputs are left out, not scored as zero.</p>
            </HowCalculated>
          </div>
        </Card>
      )}

      {view === "jobs" && (
        <Card pad={false}>
          <Table head={["Job", "Client", "Hours", "Revenue", ...(costs ? ["People cost"] : []), "Margin"]} empty="No job activity in this period.">
            {prof.jobs.slice(0, 30).map((j) => (
              <tr key={j.id}>
                <Td><Link className="hover:underline" href={`/app/jobs/${j.id}?tab=money`}><span className="font-medium">{j.number}</span> <span className="text-ink-2">{j.name}</span></Link></Td>
                <Td className="text-ink-2">{j.company_name}</Td>
                <Td right>{Math.round(j.hours_win)}</Td>
                <Td right><Money cents={j.revenue} compact /></Td>
                {costs && <Td right><Money cents={j.labour} compact /></Td>}
                <Td right className={marginTone(j.margin)}><Pct n={j.margin} /></Td>
              </tr>
            ))}
          </Table>
          <div className="px-4 pb-4">
            <HowCalculated>
              <p>Lowest margin first; the 30 jobs with the most to fix. Retainer revenue is counted at client level (prorated period fees), so retainer jobs show hours and cost here and their revenue on the Clients tab.</p>
            </HowCalculated>
          </div>
        </Card>
      )}

      {view === "people" && (
        <Card pad={false}>
          <Table head={["Person", "Billable vs target", "Billable hours", "Unused capacity"]} empty="No time logged in this period.">
            {data.people
              .filter((p) => p.target_utilisation > 0)
              .map((p) => (
                <tr key={p.id}>
                  <Td>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-ink-3">{p.title}</div>
                  </Td>
                  <Td className="w-64">
                    <Meter value={p.utilisation ?? 0} max={p.target_utilisation} compact warnAt={10} label={`Target ${Math.round(p.target_utilisation * 100)}%`} sublabel={`${Math.round((p.utilisation ?? 0) * 100)}%`} />
                  </Td>
                  <Td right>{Math.round(p.billable)}h <span className="text-ink-3">/ {Math.round(p.available)}h</span></Td>
                  <Td right>{p.gapHours ? <>{Math.round(p.gapHours)}h <span className="text-ink-3">· {compact(p.gapValue)}</span></> : "—"}</Td>
                </tr>
              ))}
          </Table>
          <div className="px-4 pb-4">
            <p className="mt-4 text-sm text-ink-2">
              Pitch and internal time: <b className="font-semibold text-ink">{Math.round(prof.internal.hours)}h</b>
              {costs && <> costing <Money cents={prof.internal.labour} compact /></>}, not charged to clients.
            </p>
            <HowCalculated>
              <p>Billable share = billable hours ÷ available hours (contracted hours, Monday to Friday). Targets are set per person, so a designer and an account manager are judged fairly. Unused capacity is the gap to target, valued at each person&apos;s rate.</p>
            </HowCalculated>
          </div>
        </Card>
      )}
    </>
  );
}
