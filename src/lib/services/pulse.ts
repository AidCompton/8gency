import type { Tx } from "../db";
import { addDays, daysBetween, startOfMonth, endOfMonth, todayIn, workingDays } from "../domain/dates";
import { availableHours, clientHealth, dso, effectiveHourlyRate, projectMargin, utilisation } from "../domain/metrics";
import { agencySettings } from "./core";
import { debtors, readyToBill, wipValuation } from "./billing";

export interface Window {
  from: string;
  to: string;
}

export function lastNDays(n: number, timezone: string): Window {
  const to = todayIn(timezone);
  return { from: addDays(to, -(n - 1)), to };
}

/**
 * Earned revenue per job inside a window (the same definition everywhere, PF-08):
 *  - fixed: (fee + approved CRs) spread over max(budget, hours logged), times hours in window
 *  - T&M: billable hours in window × snapshotted rate
 *  - retainer: period fees prorated by days in window, attributed at retainer level
 *  - re-billable costs: amount incl. markup on the date incurred (pass-through; excluded from AGI)
 */
export async function profitability(tx: Tx, w: Window) {
  const jobs = await tx.q<{
    id: string; number: string; name: string; company_id: string; company_name: string; billing_model: string; job_type: string;
    fee_cents: number; budget_hours: number; cr_approved: number; hours_total: number; hours_win: number; value_win: number; cost_win: number;
  }>(
    `select j.id, j.number, j.name, j.company_id, c.name as company_name, j.billing_model, j.job_type, j.fee_cents, j.budget_hours,
            coalesce((select sum(price_cents) from change_requests cr where cr.job_id = j.id and cr.status = 'approved'),0) as cr_approved,
            coalesce(t.hours_total,0) as hours_total, coalesce(t.hours_win,0) as hours_win, coalesce(t.value_win,0) as value_win, coalesce(t.cost_win,0) as cost_win
       from jobs j join companies c on c.id = j.company_id
       left join (select job_id, sum(hours) as hours_total,
                         sum(hours) filter (where work_date between $1 and $2) as hours_win,
                         sum(hours*rate_cents) filter (where work_date between $1 and $2 and category='billable') as value_win,
                         sum(hours*cost_cents) filter (where work_date between $1 and $2) as cost_win
                    from time_entries group by job_id) t on t.job_id = j.id
      where coalesce(t.hours_win,0) > 0 or j.billing_model = 'fixed'`,
    [w.from, w.to],
  );
  const costs = await tx.q<{ job_id: string; direct: number; rebill: number }>(
    `select job_id, sum(amount_cents) as direct, sum(round(amount_cents*(1+markup))) filter (where rebillable) as rebill
       from costs where incurred_on between $1 and $2 group by job_id`,
    [w.from, w.to],
  );
  const retainerRev = await tx.q<{ company_id: string; retainer_id: string; cents: number }>(
    `select r.company_id, r.id as retainer_id,
            sum(p.fee_cents * (least(p.ends_on, $2::date) - greatest(p.starts_on, $1::date) + 1)::numeric / (p.ends_on - p.starts_on + 1)) as cents
       from retainer_periods p join retainers r on r.id = p.retainer_id
      where p.starts_on <= $2 and p.ends_on >= $1 group by r.company_id, r.id`,
    [w.from, w.to],
  );
  const crRetainer = await tx.q<{ company_id: string; cents: number }>(
    `select company_id, sum(price_cents) as cents from change_requests
      where status = 'approved' and job_id is null and decided_at::date between $1 and $2 group by company_id`,
    [w.from, w.to],
  );

  const costMap = new Map(costs.map((c) => [c.job_id, c]));
  const jobRows = jobs
    .map((j) => {
      let revenue = 0;
      if (j.billing_model === "fixed") {
        const denom = Math.max(j.budget_hours, j.hours_total);
        revenue = denom > 0 ? Math.round(((j.fee_cents + j.cr_approved) * j.hours_win) / denom) : 0;
      } else if (j.billing_model === "tm") revenue = Math.round(j.value_win);
      const c = costMap.get(j.id);
      const passThrough = c?.rebill ?? 0;
      return { ...j, revenue: revenue + passThrough, agi: revenue + passThrough - (c?.direct ?? 0), labour: Math.round(j.cost_win), direct: c?.direct ?? 0 };
    })
    .filter((j) => j.hours_win > 0 || j.revenue > 0);

  const clients = new Map<string, { company_id: string; name: string; revenue: number; labour: number; direct: number; hours: number; agi: number }>();
  const touch = (id: string, name: string) => {
    if (!clients.has(id)) clients.set(id, { company_id: id, name, revenue: 0, labour: 0, direct: 0, hours: 0, agi: 0 });
    return clients.get(id)!;
  };
  // Internal and pitch jobs are new-business and overhead cost, not client cost (NB-03).
  const internal = { hours: 0, labour: 0 };
  for (const j of jobRows.filter((x) => x.billing_model === "internal")) {
    internal.hours += j.hours_win;
    internal.labour += j.labour;
  }
  const clientJobs = jobRows.filter((j) => j.billing_model !== "internal");
  for (const j of clientJobs) {
    const c = touch(j.company_id, j.company_name);
    c.revenue += j.revenue;
    c.labour += j.labour;
    c.direct += j.direct;
    c.hours += j.hours_win;
    c.agi += j.agi;
  }
  const names = new Map((await tx.q<{ id: string; name: string }>("select id, name from companies")).map((c) => [c.id, c.name]));
  for (const r of retainerRev) {
    const c = touch(r.company_id, names.get(r.company_id) ?? "");
    c.revenue += Math.round(r.cents);
    c.agi += Math.round(r.cents);
  }
  for (const r of crRetainer) {
    const c = touch(r.company_id, names.get(r.company_id) ?? "");
    c.revenue += r.cents;
    c.agi += r.cents;
  }
  const clientRows = [...clients.values()]
    .map((c) => ({ ...c, profit: c.revenue - c.labour - c.direct, margin: projectMargin(c.revenue, c.labour, c.direct), ehr: effectiveHourlyRate(c.agi, c.hours) }))
    .sort((a, b) => (a.margin ?? 1) - (b.margin ?? 1));

  // Service lines by job type.
  const services = new Map<string, { job_type: string; revenue: number; labour: number; hours: number }>();
  for (const j of clientJobs) {
    const s = services.get(j.job_type) ?? { job_type: j.job_type, revenue: 0, labour: 0, hours: 0 };
    s.revenue += j.revenue;
    s.labour += j.labour;
    s.hours += j.hours_win;
    services.set(j.job_type, s);
  }

  const totals = clientRows.reduce(
    (t, c) => ({ revenue: t.revenue + c.revenue, labour: t.labour + c.labour, direct: t.direct + c.direct, agi: t.agi + c.agi, hours: t.hours + c.hours }),
    { revenue: 0, labour: 0, direct: 0, agi: 0, hours: 0 },
  );
  return {
    internal,
    jobs: clientJobs.map((j) => ({ ...j, margin: projectMargin(j.revenue, j.labour, j.direct) })).sort((a, b) => (a.margin ?? 1) - (b.margin ?? 1)),
    clients: clientRows,
    services: [...services.values()].map((s) => ({ ...s, margin: projectMargin(s.revenue, s.labour, 0) })),
    totals: { ...totals, profit: totals.revenue - totals.labour - totals.direct, margin: projectMargin(totals.revenue, totals.labour, totals.direct) },
  };
}

/** Utilisation and realisation by person (TT-03). */
export async function utilisationByPerson(tx: Tx, w: Window) {
  const people = await tx.q<{ id: string; name: string; title: string; role: string; weekly_hours: number; target_utilisation: number; hours: number; billable: number; value: number; billed: number; cost_rate_cents: number; rate_cents: number }>(
    `select u.id, u.name, u.title, u.role, u.weekly_hours, u.target_utilisation, u.cost_rate_cents,
            coalesce(sum(te.hours),0) as hours,
            coalesce(sum(te.hours) filter (where te.category='billable'),0) as billable,
            coalesce(sum(te.hours*te.rate_cents) filter (where te.category='billable'),0) as value,
            coalesce(sum(te.hours*te.rate_cents) filter (where te.category='billable' and te.invoice_line_id is not null),0) as billed,
            coalesce(round(avg(te.rate_cents) filter (where te.category='billable')),0) as rate_cents
       from users u left join time_entries te on te.user_id = u.id and te.work_date between $1 and $2
      where u.active group by u.id order by u.name`,
    [w.from, w.to],
  );
  const days = workingDays(w.from, w.to);
  return people.map((p) => {
    const available = availableHours(p.weekly_hours, days);
    const util = utilisation(p.billable, available);
    const gapHours = Math.max(0, p.target_utilisation * available - p.billable);
    return { ...p, available, utilisation: util, gapHours, gapValue: Math.round(gapHours * (p.rate_cents || 0)) };
  });
}

/**
 * The Agency Health Scan (M19, promise #2): last 90 days, every finding with a
 * money value, so the owner sees where money leaks before paying for 8gency.
 */
export async function healthScan(tx: Tx, days = 90) {
  const settings = await agencySettings(tx);
  const w = lastNDays(days, settings.timezone);

  const absorbed = await tx.q<{ company_name: string; cents: number; n: number }>(
    `select c.name as company_name, sum(v.cents) as cents, sum(v.n)::int as n from (
        select company_id, price_cents as cents, 1 as n from change_requests where status = 'absorbed' and coalesce(decided_at, created_at)::date between $1 and $2
        union all
        select j.company_id, te.hours*te.rate_cents, 0 from time_entries te join jobs j on j.id = te.job_id
         where te.oos_resolution = 'absorbed' and te.work_date between $1 and $2
        union all
        select company_id, price_cents, 1 from change_requests where status in ('draft') and created_at::date between $1 and $2
     ) v join companies c on c.id = v.company_id group by c.name order by 2 desc`,
    [w.from, w.to],
  );

  const retainerOver = await tx.q<{ company_name: string; retainer_name: string; starts_on: string; allocated: number; used: number; rate: number }>(
    `select c.name as company_name, r.name as retainer_name, p.starts_on::text, p.allocated_hours + p.rollover_in_hours as allocated,
            coalesce((select sum(te.hours) from time_entries te join jobs j on j.id = te.job_id
                       where j.retainer_id = r.id and te.work_date between p.starts_on and p.ends_on),0) as used,
            coalesce((select round(avg(te.rate_cents)) from time_entries te join jobs j on j.id = te.job_id
                       where j.retainer_id = r.id and te.work_date between p.starts_on and p.ends_on),0) as rate
       from retainer_periods p join retainers r on r.id = p.retainer_id join companies c on c.id = r.company_id
      where p.ends_on >= $1 and p.starts_on <= $2
        and not exists (select 1 from change_requests cr where cr.retainer_period_id = p.id and cr.status = 'approved')`,
    [w.from, w.to],
  );
  const overserviced = retainerOver
    .filter((r) => r.used > r.allocated)
    .map((r) => ({ ...r, overHours: r.used - r.allocated, cents: Math.round((r.used - r.allocated) * r.rate) }));

  const billable = await readyToBill(tx);
  const unbilled = billable.filter((b) => b.overdue);
  const { open } = await debtors(tx);
  const overdue = open.filter((o) => o.daysOverdue > 0);
  const prof = await profitability(tx, w);
  const leastProfitable = prof.clients.filter((c) => c.revenue > 0 && (c.margin ?? 0) < 0.25).slice(0, 5);
  const util = await utilisationByPerson(tx, w);
  const underUtilised = util.filter((p) => p.available > 0 && (p.utilisation ?? 0) < p.target_utilisation - 0.05 && ["staff", "pm"].includes(p.role));

  const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);
  const findings = [
    { key: "absorbed", title: "Out-of-scope work given away", detail: "Absorbed change requests, absorbed out-of-scope time and change requests never sent", cents: Math.round(sum(absorbed, (a) => a.cents)), rows: absorbed.length, href: "/app/scope?tab=absorbed" },
    { key: "retainers", title: "Overserviced retainers", detail: "Hours delivered above the retainer allowance, valued at the rates actually logged", cents: sum(overserviced, (o) => o.cents), rows: overserviced.length, href: "/app/retainers" },
    { key: "unbilled", title: "Billable work not yet invoiced", detail: `Ready to bill for more than ${settings.bill_within_days} days`, cents: sum(unbilled, (u) => u.amount_cents), rows: unbilled.length, href: "/app/billing" },
    { key: "overdue", title: "Overdue invoices", detail: "Cash owed past its due date", cents: sum(overdue, (o) => o.outstanding), rows: overdue.length, href: "/app/billing?tab=debtors" },
    { key: "margin", title: "Low-margin clients", detail: "Profit lost against a 25% margin floor", cents: Math.round(sum(leastProfitable, (c) => Math.max(0, 0.25 * c.revenue - c.profit))), rows: leastProfitable.length, href: "/app/pulse" },
    { key: "utilisation", title: "Billable capacity unused", detail: "Hours below each person's utilisation target, at their average rate", cents: sum(underUtilised, (p) => p.gapValue), rows: underUtilised.length, href: "/app/pulse#people" },
  ];
  return {
    window: w,
    // Money leaking now. Overdue cash and unused capacity are shown separately:
    // one is owed rather than lost, the other is opportunity rather than leakage.
    total: sum(findings.filter((f) => !["overdue", "utilisation"].includes(f.key)), (f) => f.cents),
    cashAtRisk: findings.find((f) => f.key === "overdue")!.cents,
    capacityValue: findings.find((f) => f.key === "utilisation")!.cents,
    findings,
    absorbed,
    overserviced,
    unbilled,
    overdue,
    leastProfitable,
    underUtilised,
  };
}

/** Client health score per client (CL-05). */
export async function clientHealthScores(tx: Tx, days = 90) {
  const settings = await agencySettings(tx);
  const w = lastNDays(days, settings.timezone);
  const rows = await tx.q<{
    id: string; name: string; satisfaction: number | null; delivered: number; on_time: number; scoped_hours: number; oos_hours: number;
    avg_days_late: number | null; avg_approval_hours: number | null;
  }>(
    `select c.id, c.name, c.satisfaction,
            (select count(*)::int from deliverables d join jobs j on j.id = d.job_id where j.company_id = c.id and d.approved_at::date between $1 and $2) as delivered,
            (select count(*)::int from deliverables d join jobs j on j.id = d.job_id where j.company_id = c.id and d.approved_at::date between $1 and $2
                and (d.due_date is null or d.approved_at::date <= d.due_date)) as on_time,
            (select coalesce(sum(hours),0) from time_entries te join jobs j on j.id = te.job_id where j.company_id = c.id and te.work_date between $1 and $2) as scoped_hours,
            (select coalesce(sum(hours),0) from time_entries te join jobs j on j.id = te.job_id where j.company_id = c.id and te.out_of_scope and te.oos_resolution = 'absorbed' and te.work_date between $1 and $2) as oos_hours,
            (select avg(greatest(0, coalesce(i.paid_at::date, current_date) - i.due_date)) from invoices i where i.company_id = c.id and i.status in ('sent','paid') and i.due_date >= $1) as avg_days_late,
            (select avg(extract(epoch from (a.created_at - d.sent_to_client_at))/3600) from approvals a join deliverables d on d.id = a.subject_id
              join jobs j on j.id = d.job_id where a.subject_type = 'deliverable' and a.stage = 'client' and j.company_id = c.id and a.created_at::date between $1 and $2
              and d.sent_to_client_at is not null and a.created_at >= d.sent_to_client_at) as avg_approval_hours
       from companies c where c.kind = 'client' and c.status in ('active','onboarding') order by c.name`,
    [w.from, w.to],
  );
  return rows.map((r) => {
    const h = clientHealth({
      onTimeRate: r.delivered ? r.on_time / r.delivered : null,
      overservicingRate: r.scoped_hours ? r.oos_hours / r.scoped_hours : null,
      avgDaysLate: r.avg_days_late,
      avgApprovalDays: r.avg_approval_hours === null ? null : r.avg_approval_hours / 24,
      satisfaction: r.satisfaction,
    });
    return { ...r, ...h };
  });
}

/** Owner dashboard numbers (4.7): profit this month and forecast, cash, utilisation, overservicing. */
export async function ownerSummary(tx: Tx) {
  const settings = await agencySettings(tx);
  const today = todayIn(settings.timezone);
  const month = { from: startOfMonth(today), to: today };
  const monthEnd = endOfMonth(today);
  const prof = await profitability(tx, month);
  const elapsed = (daysBetween(month.from, today) + 1) / (daysBetween(month.from, monthEnd) + 1);
  const people = (await utilisationByPerson(tx, month)).filter((p) => p.target_utilisation > 0);
  const totalAvailable = people.reduce((s, p) => s + p.available, 0);
  const totalBillable = people.reduce((s, p) => s + p.billable, 0);
  const d = await debtors(tx);
  const wip = await wipValuation(tx);
  const rev90 = (await profitability(tx, lastNDays(90, settings.timezone))).totals.revenue;
  const absorbedMonth = (await tx.one<{ v: number }>(
    "select coalesce(sum(price_cents),0) as v from change_requests where status = 'absorbed' and decided_at::date between $1 and $2",
    [month.from, month.to],
  ))!.v;
  const dueIn30 = d.open.filter((o) => o.due_date && o.due_date <= addDays(today, 30)).reduce((s, o) => s + o.outstanding, 0);
  return {
    month,
    revenue: prof.totals.revenue,
    profit: prof.totals.profit,
    margin: prof.totals.margin,
    forecastProfit: elapsed > 0 ? Math.round(prof.totals.profit / elapsed) : prof.totals.profit,
    forecastRevenue: elapsed > 0 ? Math.round(prof.totals.revenue / elapsed) : prof.totals.revenue,
    utilisation: utilisation(totalBillable, totalAvailable),
    debtors: d.total,
    overdueDebtors: d.open.filter((o) => o.daysOverdue > 0).reduce((s, o) => s + o.outstanding, 0),
    expectedIn30: dueIn30,
    dso: dso(d.total, rev90, 90),
    wip: wip.reduce((s, j) => s + j.wip, 0),
    absorbedMonth,
  };
}
