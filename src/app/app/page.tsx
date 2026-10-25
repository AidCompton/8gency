import type { Icon } from "@phosphor-icons/react";
import { ArrowsLeftRight, Briefcase, Buildings, CaretRight, CheckCircle, Clock, Eye, Gift, Receipt, Repeat, Tray } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SubmitButton } from "@/components/SubmitButton";
import { loadSampleAction } from "./_actions/sample";
import { Card, LinkButton, buttonClass, Money, PageHeader, Pct, Stat, TONE, TextLink, cx } from "@/components/ui";
import { requireUser, tenant } from "@/lib/auth";
import { ageSince } from "@/lib/domain/dates";
import { formatMoney } from "@/lib/domain/money";
import { firstName } from "@/lib/domain/text";
import { can } from "@/lib/permissions";
import { runAutomations } from "@/lib/services/automations";
import { wipRisks } from "@/lib/services/eightgent";
import { fixList } from "@/lib/services/fixes";
import { clientHealthScores, healthScan, ownerSummary } from "@/lib/services/pulse";
import { listRetainers } from "@/lib/services/retainers";
import { reviewsWaiting } from "@/lib/services/review";

export const metadata = { title: "Home" };

const compact = (c: number) => formatMoney(c, "ZAR", { compact: true });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Severity = "critical" | "warning" | "info";
interface Item {
  severity: Severity;
  icon: Icon;
  title: string;
  meta?: string;
  href: string;
  action: string;
}
const TONE_OF: Record<Severity, keyof typeof TONE> = { critical: "critical", warning: "warning", info: "info" };
const RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

function AttentionRow({ i }: { i: Item }) {
  return (
    <li>
      <Link href={i.href} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2/60">
        <span aria-hidden className={cx("grid h-9 w-9 shrink-0 place-items-center rounded-lg", TONE[TONE_OF[i.severity]])}>
          <i.icon size={18} weight="bold" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{i.title}</span>
          {i.meta && <span className="block truncate text-xs text-ink-3">{i.meta}</span>}
        </span>
        <span className="hidden shrink-0 items-center gap-1 text-xs font-medium text-ink-3 transition-colors group-hover:text-brand sm:inline-flex">
          {i.action}
          <CaretRight aria-hidden size={12} weight="bold" />
        </span>
      </Link>
    </li>
  );
}

export default async function Home() {
  const user = await requireUser();
  if (!can(user, "seeMargins")) redirect("/app/my-day");
  const data = await tenant(user, async (tx) => {
    await runAutomations(tx);
    const mine = user.role === "account" ? user.id : null;
    return {
      summary: await ownerSummary(tx),
      scan: await healthScan(tx),
      fixes: await fixList(tx),
      noScope: await tx.q<{ id: string; label: string }>("select j.id, j.number || ' ' || j.name as label from jobs j where j.status in ('briefing','in_progress','waiting_client') and j.billing_model <> 'internal' and j.retainer_id is null and not exists (select 1 from scope_items s where s.job_id = j.id) order by j.created_at"),
      empty: !(await tx.one("select 1 from companies limit 1")),
      risks: await wipRisks(tx),
      health: await clientHealthScores(tx),
      reviews: await reviewsWaiting(tx),
      retainers: await listRetainers(tx),
      triage: (await tx.one<{ n: number }>("select count(*)::int as n from client_requests where status = 'new'"))!.n,
      waitingClient: await tx.q<{ id: string; name: string; company_name: string; sent_to_client_at: Date }>(
        `select d.id, d.name, c.name as company_name, d.sent_to_client_at from deliverables d join jobs j on j.id = d.job_id join companies c on c.id = j.company_id
          where d.status = 'client_review' and ($1::uuid is null or j.account_manager_id = $1) order by d.sent_to_client_at`,
        [mine],
      ),
      crOpen: (await tx.one<{ n: number }>(
        `select count(*)::int as n from change_requests cr join companies c on c.id = cr.company_id
          where cr.status in ('draft','sent') and ($1::uuid is null or c.account_manager_id = $1)`,
        [mine],
      ))!.n,
    };
  });
  const s = data.summary;
  const monthName = new Date(`${s.month.from}T00:00:00Z`).toLocaleDateString("en-ZA", { month: "long", timeZone: "UTC" });

  // One prioritised list instead of a card per topic: the most urgent things first.
  const items: Item[] = [];
  const fixValue = data.fixes.reduce((t, f) => t + (f.cents ?? 0), 0);
  if (data.fixes.length) items.push({ severity: "warning", icon: Receipt, title: `${plural(data.fixes.length, "fix")} ready: ${compact(fixValue)} you can recover`, meta: "Invoices to draft, change requests to send, reminders to go out", href: "/app/pulse", action: "Fix now" });
  if (data.noScope.length)
    items.push({ severity: "warning", icon: Briefcase, title: `${plural(data.noScope.length, "live job")} ${data.noScope.length === 1 ? "has" : "have"} no scope yet`, meta: data.noScope.length === 1 ? data.noScope[0].label : `${data.noScope[0].label} and ${data.noScope.length - 1} more: without a scope, extra work goes unnoticed`, href: `/app/jobs/${data.noScope[0].id}?tab=scope`, action: "Add scope" });
  if (s.overdueDebtors > 0) items.push({ severity: "critical", icon: Receipt, title: `${compact(s.overdueDebtors)} overdue from clients`, meta: `${compact(s.debtors)} owed in total`, href: "/app/billing?tab=debtors", action: "Chase" });
  for (const r of data.retainers.filter((r) => r.burn?.alert))
    items.push({ severity: "critical", icon: Repeat, title: `${r.retainer.company_name} retainer is ahead of the month`, meta: `${r.usedHours}h of ${r.allocated}h used so far`, href: `/app/retainers/${r.retainer.id}`, action: "Review" });
  for (const c of data.health.filter((c) => c.band === "at_risk"))
    items.push({ severity: "critical", icon: Buildings, title: `${c.name} looks at risk`, meta: `Client health ${c.score} / 100`, href: `/app/clients/${c.id}`, action: "Open" });
  for (const r of data.risks.slice(0, 4))
    items.push({ severity: "warning", icon: Briefcase, title: `${r.number} ${r.name}`, meta: r.reasons[0] + (r.reasons.length > 1 ? ` · ${plural(r.reasons.length - 1, "more issue")}` : ""), href: `/app/jobs/${r.job_id}`, action: "Open" });
  if (data.triage) items.push({ severity: "warning", icon: Tray, title: `${plural(data.triage, "new client request")} to triage`, href: "/app/scope", action: "Triage" });
  if (s.absorbedMonth > 0) items.push({ severity: "warning", icon: Gift, title: `${compact(s.absorbedMonth)} of extra work given away this month`, meta: "Absorbed instead of charged", href: "/app/scope?tab=absorbed", action: "Review" });
  if (data.crOpen) items.push({ severity: "info", icon: ArrowsLeftRight, title: `${plural(data.crOpen, "change request")} waiting`, href: "/app/scope?tab=changes", action: "Open" });
  if (data.reviews.length) items.push({ severity: "info", icon: Eye, title: `${plural(data.reviews.length, "internal review")} waiting`, href: "/app/my-day", action: "Review" });
  if (data.waitingClient.length)
    items.push({ severity: "info", icon: Clock, title: `${plural(data.waitingClient.length, "deliverable")} with clients`, meta: `Oldest: ${data.waitingClient[0].company_name}, ${ageSince(data.waitingClient[0].sent_to_client_at)}`, href: "/app/jobs?status=waiting_client", action: "Open" });
  items.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  const shown = items.slice(0, 6);
  const more = items.slice(6);

  const leaks = data.scan.findings.filter((f) => !["overdue", "utilisation"].includes(f.key) && f.cents > 0).sort((a, b) => b.cents - a.cents);
  const topLeak = Math.max(1, ...leaks.map((f) => f.cents));

  return (
    <>
      <PageHeader
        title={`Good day, ${firstName(user.name)}`}
        subtitle={
          <>
            {monthName} so far: <b className="font-semibold text-ink">{compact(s.profit)} profit</b>, on track for {compact(s.forecastProfit)}.{" "}
            {items.length ? `${plural(items.length, "thing needs", "things need")} your attention.` : "Nothing needs your attention."}
          </>
        }
        actions={<LinkButton href="/app/pulse">Open Pulse</LinkButton>}
      />

      {data.empty && (
        <div className="mb-6 rounded-xl border border-brand/30 bg-brand/5 p-5">
          <h2 className="text-base font-semibold">Nothing here yet. Want to see it working first?</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-2">Explore a made-up agency with real-looking problems to find and fix, with a short guided tour. You can clear it in one click, and it never touches your own data. Or bring in your own now.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <form action={loadSampleAction}><SubmitButton className={buttonClass("primary")}>Explore a sample agency</SubmitButton></form>
            <LinkButton href="/app/settings?tab=import">Import my own data</LinkButton>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Profit this month" value={<Money cents={s.profit} compact />} hint={`On track for ${compact(s.forecastProfit)}`} tone={s.margin !== null && s.margin < 0.15 ? "warning" : undefined} href="/app/pulse" />
        <Stat label="Owed to you" value={<Money cents={s.debtors} compact />} hint={s.overdueDebtors ? `${compact(s.overdueDebtors)} overdue` : "Nothing overdue"} tone={s.overdueDebtors ? "critical" : "good"} href="/app/billing?tab=debtors" />
        <Stat label="Ready to invoice" value={<Money cents={s.wip} compact />} hint="Work done, not billed yet" href="/app/billing?tab=wip" />
        <Stat label="Team on billable work" value={<Pct n={s.utilisation} />} hint="This month" tone={(s.utilisation ?? 0) < 0.55 ? "warning" : "good"} href="/app/pulse?tab=people" />
      </div>

      <div className="mt-6 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card id="tour-attention" title="Needs your attention" pad={false} actions={items.length ? <span className="text-xs text-ink-3">Most urgent first</span> : null}>
          {items.length ? (
            <>
              <ul className="divide-y divide-line">{shown.map((i, n) => <AttentionRow key={n} i={i} />)}</ul>
              {more.length > 0 && (
                <details className="group border-t border-line">
                  <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-brand hover:bg-surface-2/60 pointer-coarse:py-4 [&::-webkit-details-marker]:hidden">
                    <span className="group-open:hidden">Show {plural(more.length, "more item")}</span>
                    <span className="hidden group-open:inline">Show fewer</span>
                  </summary>
                  <ul className="divide-y divide-line border-t border-line">{more.map((i, n) => <AttentionRow key={n} i={i} />)}</ul>
                </details>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-ink-2">
              <CheckCircle aria-hidden size={28} weight="fill" className="text-good-ink" />
              All clear: nothing is overdue, at risk or waiting on you.
            </div>
          )}
        </Card>

        <Card title="Where money is leaking" actions={<TextLink href="/app/pulse">Full scan</TextLink>}>
          <div className="text-3xl font-semibold tracking-tight tnum">{compact(data.scan.total)}</div>
          <p className="mt-1 text-sm text-ink-2">lost in the last 90 days</p>
          {leaks.length ? (
            <ul className="mt-5 space-y-3.5">
              {leaks.slice(0, 4).map((f) => (
                <li key={f.key}>
                  <Link href={f.href} className="group block rounded">
                    <span className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate text-ink-2 group-hover:text-ink">{f.title}</span>
                      <span className="tnum font-medium">{compact(f.cents)}</span>
                    </span>
                    <span aria-hidden className="mt-1.5 block h-1.5 rounded-full bg-track">
                      <span className="block h-full rounded-full bg-seq" style={{ width: `${Math.max(4, (f.cents / topLeak) * 100)}%` }} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-ink-3">No leaks found.</p>
          )}
        </Card>
      </div>
    </>
  );
}
