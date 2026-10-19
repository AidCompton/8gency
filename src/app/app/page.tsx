import Link from "next/link";
import { redirect } from "next/navigation";
import { BarList, Card, Empty, LinkButton, Meter, Money, PageHeader, Pct, Stat, HealthBadge } from "@/components/ui";
import { requireUser, tenant } from "@/lib/auth";
import { ageSince } from "@/lib/domain/dates";
import { formatMoney } from "@/lib/domain/money";
import { can } from "@/lib/permissions";
import { runAutomations } from "@/lib/services/automations";
import { wipRisks } from "@/lib/services/eightgent";
import { clientHealthScores, healthScan, ownerSummary } from "@/lib/services/pulse";
import { listRetainers } from "@/lib/services/retainers";
import { reviewsWaiting } from "@/lib/services/review";

export const metadata = { title: "Home" };

export default async function Home() {
  const user = await requireUser();
  if (!can(user, "seeMargins")) redirect("/app/my-day");
  const data = await tenant(user, async (tx) => {
    await runAutomations(tx);
    const mine = user.role === "account" ? user.id : null;
    return {
      summary: await ownerSummary(tx),
      scan: await healthScan(tx),
      risks: (await wipRisks(tx)).slice(0, 6),
      health: (await clientHealthScores(tx)).filter((c) => c.score !== null).sort((a, b) => (a.score ?? 0) - (b.score ?? 0)),
      reviews: await reviewsWaiting(tx),
      retainers: (await listRetainers(tx)).filter((r) => !mine || r.retainer.company_id),
      triage: (await tx.one<{ n: number }>("select count(*)::int as n from client_requests where status = 'new'"))!.n,
      waitingClient: await tx.q<{ id: string; name: string; company_name: string; sent_to_client_at: Date }>(
        `select d.id, d.name, c.name as company_name, d.sent_to_client_at from deliverables d join jobs j on j.id = d.job_id join companies c on c.id = j.company_id
          where d.status = 'client_review' and ($1::uuid is null or j.account_manager_id = $1) order by d.sent_to_client_at limit 8`,
        [mine],
      ),
      crOpen: await tx.q<{ id: string; title: string; status: string; price_cents: number; company_name: string }>(
        `select cr.id, cr.title, cr.status, cr.price_cents, c.name as company_name from change_requests cr join companies c on c.id = cr.company_id
          where cr.status in ('draft','sent') and ($1::uuid is null or c.account_manager_id = $1) order by cr.created_at desc limit 8`,
        [mine],
      ),
    };
  });
  const s = data.summary;
  const monthName = new Date(`${s.month.from}T00:00:00Z`).toLocaleDateString("en-ZA", { month: "long", timeZone: "UTC" });
  return (
    <>
      <PageHeader title={`Good day, ${user.name.split(" ")[0]}`} subtitle={`${user.agency_name} · ${monthName} to date`} actions={<LinkButton href="/app/pulse">Open Pulse</LinkButton>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Profit this month" value={<Money cents={s.profit} compact />} hint={<>Forecast <Money cents={s.forecastProfit} compact /> · margin <Pct n={s.margin} /></>} tone={s.margin !== null && s.margin < 0.15 ? "warning" : undefined} href="/app/pulse" />
        <Stat label="Cash owed to you" value={<Money cents={s.debtors} compact />} hint={s.overdueDebtors ? <>{formatMoney(s.overdueDebtors, "ZAR", { compact: true })} overdue · DSO {s.dso ?? "—"}d</> : `DSO ${s.dso ?? "—"} days`} tone={s.overdueDebtors ? "critical" : undefined} href="/app/billing?tab=debtors" />
        <Stat label="Unbilled WIP" value={<Money cents={s.wip} compact />} hint="Work done, not yet invoiced" href="/app/billing?tab=wip" />
        <Stat label="Billable utilisation" value={<Pct n={s.utilisation} />} hint="Delivery team, this month" tone={(s.utilisation ?? 0) < 0.55 ? "warning" : "good"} href="/app/pulse#people" />
        <Stat label="Scope given away" value={<Money cents={s.absorbedMonth} compact />} hint="Absorbed this month" tone={s.absorbedMonth > 0 ? "warning" : "good"} href="/app/scope?tab=absorbed" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card title="Agency Health Scan · last 90 days" className="lg:col-span-2" actions={<Link className="text-sm text-brand hover:underline" href="/app/pulse">Full scan →</Link>}>
          <p className="mb-4 text-sm text-ink-2">
            <span className="text-2xl font-semibold text-ink tnum">{formatMoney(data.scan.total, "ZAR", { compact: true })}</span> leaking from scope, retainers, billing and pricing,
            plus <b className="tnum">{formatMoney(data.scan.cashAtRisk, "ZAR", { compact: true })}</b> overdue.
          </p>
          <BarList
            rows={data.scan.findings.filter((f) => f.key !== "utilisation").map((f) => ({ label: f.title, value: f.cents, href: f.href, negative: f.key === "overdue" }))}
            format={(v) => formatMoney(v, "ZAR", { compact: true })}
          />
        </Card>
        <Card title="Needs you">
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between"><Link className="hover:underline" href="/app/scope">New client requests to triage</Link><b className="tnum">{data.triage}</b></li>
            <li className="flex justify-between"><Link className="hover:underline" href="/app/scope?tab=changes">Change requests open</Link><b className="tnum">{data.crOpen.length}</b></li>
            <li className="flex justify-between"><Link className="hover:underline" href="/app/my-day">Internal reviews waiting</Link><b className="tnum">{data.reviews.length}</b></li>
          </ul>
          <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-ink-3">Waiting on clients</h3>
          {data.waitingClient.length ? (
            <ul className="space-y-1.5 text-sm">
              {data.waitingClient.map((w) => (
                <li key={w.id} className="flex justify-between gap-2">
                  <Link href={`/app/deliverables/${w.id}`} className="truncate hover:underline">{w.company_name}: {w.name}</Link>
                  <span className="shrink-0 text-ink-3 tnum">{ageSince(w.sent_to_client_at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-3">Nothing with clients.</p>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Jobs at risk" actions={<Link className="text-sm text-brand hover:underline" href="/app/jobs">Traffic →</Link>}>
          {data.risks.length ? (
            <ul className="space-y-3 text-sm">
              {data.risks.map((r) => (
                <li key={r.job_id}>
                  <Link href={`/app/jobs/${r.job_id}`} className="font-medium hover:underline">{r.number} · {r.name}</Link>
                  <div className="text-xs text-ink-2">{r.reasons.join(" · ")}</div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>All live jobs on pace.</Empty>
          )}
        </Card>
        <Card title="Retainer burn this month">
          {data.retainers.length ? (
            <div className="space-y-4">
              {data.retainers.map((r) => (
                <Link key={r.retainer.id} href={`/app/retainers/${r.retainer.id}`} className="block">
                  <Meter value={r.usedHours} max={r.allocated} label={`${r.retainer.company_name} · ${r.retainer.name}`} sublabel={`${r.usedHours}h / ${r.allocated}h`} marker={r.burn?.elapsed} markerLabel="month elapsed" />
                  {r.burn?.alert && <div className="mt-1 text-xs text-critical-ink">Burn is ahead of the month by {Math.round(r.burn.aheadBy * 100)} points</div>}
                </Link>
              ))}
              <p className="text-xs text-ink-3">The black tick shows how much of the month has passed.</p>
            </div>
          ) : (
            <Empty>No active retainers.</Empty>
          )}
        </Card>
        <Card title="Client health">
          {data.health.length ? (
            <ul className="space-y-2 text-sm">
              {data.health.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <Link href={`/app/clients/${c.id}`} className="truncate hover:underline">{c.name}</Link>
                  <span className="flex items-center gap-2">
                    <span className="tnum font-medium">{c.score}</span>
                    <HealthBadge band={c.band} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Health scores appear once work is delivered and invoiced.</Empty>
          )}
        </Card>
      </div>
    </>
  );
}
