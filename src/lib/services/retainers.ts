import type { Tx } from "../db";
import { addDays, addMonths, formatShort, todayIn } from "../domain/dates";
import { reconcileRetainer, retainerBurn } from "../domain/retainer";
import { agencySettings, blendedRate, notify, UserError } from "./core";
import { createJob } from "./jobs";
import { createChangeRequest } from "./scope";

export interface RetainerRow {
  id: string;
  company_id: string;
  company_name: string;
  name: string;
  fee_cents: number;
  hours_per_period: number;
  start_date: string;
  end_date: string | null;
  rollover: "none" | "capped";
  rollover_cap_hours: number;
  alert_margin: number;
  billing_timing: "advance" | "arrears";
  price_increase_pct: number;
  next_increase_date: string | null;
  status: string;
  job_template_key: string | null;
  job_owner_id: string | null;
}

export interface PeriodRow {
  id: string;
  retainer_id: string;
  starts_on: string;
  ends_on: string;
  allocated_hours: number;
  rollover_in_hours: number;
  fee_cents: number;
  status: "open" | "reconciled";
  used_hours: number | null;
  overage_hours: number | null;
  rollover_out_hours: number | null;
  overage_action: string | null;
}

export async function createRetainer(
  tx: Tx,
  input: {
    company_id: string;
    name: string;
    fee_cents: number;
    hours_per_period: number;
    start_date: string;
    rollover: "none" | "capped";
    rollover_cap_hours: number;
    billing_timing: "advance" | "arrears";
    price_increase_pct: number;
    job_template_key: string | null;
    job_owner_id: string | null;
    scope: { name: string; unit: "deliverable" | "hours"; quantity: number; rounds: number }[];
  },
) {
  if (!input.name.trim()) throw new UserError("Name the retainer.");
  const row = await tx.one<{ id: string }>(
    `insert into retainers (agency_id, company_id, name, fee_cents, hours_per_period, start_date, rollover, rollover_cap_hours, billing_timing,
                            price_increase_pct, next_increase_date, job_template_key, job_owner_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
    [
      tx.agencyId,
      input.company_id,
      input.name.trim(),
      input.fee_cents,
      input.hours_per_period,
      input.start_date,
      input.rollover,
      input.rollover_cap_hours,
      input.billing_timing,
      input.price_increase_pct,
      input.price_increase_pct > 0 ? addMonths(input.start_date, 12) : null,
      input.job_template_key,
      input.job_owner_id,
    ],
  );
  for (const s of input.scope) {
    await tx.q(
      "insert into scope_items (agency_id, company_id, retainer_id, name, unit, quantity, rounds_allowed) values ($1,$2,$3,$4,$5,$6,$7)",
      [tx.agencyId, input.company_id, row!.id, s.name, s.unit, s.quantity, s.rounds],
    );
  }
  await tx.audit("retainer.created", "retainer", row!.id, undefined, input);
  await ensurePeriods(tx, row!.id);
  return row!.id;
}

export async function getRetainer(tx: Tx, id: string) {
  return tx.one<RetainerRow>("select r.*, c.name as company_name from retainers r join companies c on c.id = r.company_id where r.id = $1", [id]);
}

/**
 * Open monthly periods up to today. Each new period carries the previous
 * period's rollover, applies the annual price increase on the anniversary
 * (PR-07) and generates the recurring job from its template (PM-07).
 */
export async function ensurePeriods(tx: Tx, retainerId: string) {
  const r = await getRetainer(tx, retainerId);
  if (!r || r.status !== "active") return;
  const settings = await agencySettings(tx);
  const today = todayIn(settings.timezone);
  const last = await tx.one<PeriodRow>("select * from retainer_periods where retainer_id = $1 order by starts_on desc limit 1", [retainerId]);
  let start = last ? addDays(last.ends_on, 1) : r.start_date;
  let guard = 0;
  while (start <= today && (!r.end_date || start <= r.end_date) && guard++ < 36) {
    const end = addDays(addMonths(start, 1), -1);
    let fee = r.fee_cents;
    if (r.next_increase_date && start >= r.next_increase_date && r.price_increase_pct > 0) {
      fee = Math.round(r.fee_cents * (1 + r.price_increase_pct / 100));
      await tx.q("update retainers set fee_cents = $2, next_increase_date = $3 where id = $1", [retainerId, fee, addMonths(r.next_increase_date, 12)]);
      await tx.audit("retainer.price_increase", "retainer", retainerId, { fee_cents: r.fee_cents }, { fee_cents: fee });
      r.fee_cents = fee;
      r.next_increase_date = addMonths(r.next_increase_date, 12);
    }
    const prev = await tx.one<PeriodRow>("select * from retainer_periods where retainer_id = $1 and ends_on = $2", [retainerId, addDays(start, -1)]);
    const rolloverIn = prev?.rollover_out_hours ?? 0;
    await tx.q(
      `insert into retainer_periods (agency_id, retainer_id, starts_on, ends_on, allocated_hours, rollover_in_hours, fee_cents)
       values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing`,
      [tx.agencyId, retainerId, start, end, r.hours_per_period, rolloverIn, fee],
    );
    if (r.job_template_key) {
      const label = new Date(`${start}T00:00:00Z`).toLocaleDateString("en-ZA", { month: "short", year: "numeric", timeZone: "UTC" });
      await createJob(tx, {
        company_id: r.company_id,
        retainer_id: r.id,
        name: `${r.name} — ${label}`,
        template_key: r.job_template_key,
        billing_model: "retainer",
        owner_id: r.job_owner_id,
        start_date: start,
        due_date: end,
        budget_hours: r.hours_per_period,
        assignee_id: r.job_owner_id,
      });
    }
    start = addDays(end, 1);
  }
}

export async function periodUsage(tx: Tx, retainerId: string, from: string, to: string) {
  const row = await tx.one<{ hours: number; value: number; cost: number }>(
    `select coalesce(sum(te.hours),0) as hours, coalesce(sum(te.hours*te.rate_cents),0) as value, coalesce(sum(te.hours*te.cost_cents),0) as cost
       from time_entries te join jobs j on j.id = te.job_id
      where j.retainer_id = $1 and te.work_date between $2 and $3`,
    [retainerId, from, to],
  );
  return row!;
}

export interface RetainerStatus {
  retainer: RetainerRow;
  period: PeriodRow | null;
  usedHours: number;
  allocated: number;
  burn: ReturnType<typeof retainerBurn> | null;
  labourCost: number;
  margin: number | null;
}

export async function retainerStatus(tx: Tx, retainerId: string): Promise<RetainerStatus | null> {
  const r = await getRetainer(tx, retainerId);
  if (!r) return null;
  const settings = await agencySettings(tx);
  const today = todayIn(settings.timezone);
  const period = await tx.one<PeriodRow>(
    "select * from retainer_periods where retainer_id = $1 and starts_on <= $2 order by starts_on desc limit 1",
    [retainerId, today],
  );
  if (!period) return { retainer: r, period: null, usedHours: 0, allocated: r.hours_per_period, burn: null, labourCost: 0, margin: null };
  const u = await periodUsage(tx, retainerId, period.starts_on, period.ends_on);
  const allocated = period.allocated_hours + period.rollover_in_hours;
  const burn = retainerBurn({ allocatedHours: allocated, usedHours: u.hours, startsOn: period.starts_on, endsOn: period.ends_on, today: today > period.ends_on ? period.ends_on : today, alertMargin: r.alert_margin });
  return {
    retainer: r,
    period,
    usedHours: u.hours,
    allocated,
    burn,
    labourCost: Math.round(u.cost),
    margin: period.fee_cents ? (period.fee_cents - u.cost) / period.fee_cents : null,
  };
}

export async function listRetainers(tx: Tx, companyId?: string) {
  const ids = await tx.q<{ id: string }>("select id from retainers where status = 'active' and ($1::uuid is null or company_id = $1) order by name", [companyId ?? null]);
  const out: RetainerStatus[] = [];
  for (const { id } of ids) {
    await ensurePeriods(tx, id);
    const s = await retainerStatus(tx, id);
    if (s) out.push(s);
  }
  return out;
}

/** Mid-month overservicing alert (M14 acceptance). Idempotent per period. */
export async function checkRetainerAlerts(tx: Tx) {
  for (const s of await listRetainers(tx)) {
    if (!s.burn?.alert || !s.period) continue;
    const am = await tx.one<{ account_manager_id: string | null }>("select account_manager_id from companies where id = $1", [s.retainer.company_id]);
    const owners = await tx.q<{ id: string }>("select id from users where role = 'owner' and active");
    await notify(tx, [am?.account_manager_id, ...owners.map((o) => o.id)], {
      kind: "retainer_burn",
      title: `${s.retainer.company_name}: retainer burn ${Math.round(s.burn.burn * 100)}% at ${Math.round(s.burn.elapsed * 100)}% of the month`,
      body: `${s.retainer.name} · ${s.usedHours}h of ${s.allocated}h used`,
      href: `/app/retainers/${s.retainer.id}`,
      dedupe: `retainer-burn:${s.period.id}:${s.burn.burn > 1 ? "over" : "ahead"}`,
    });
  }
}

/**
 * Month-end reconciliation: delivered against agreed, rollover applied,
 * overage sent as a change request or absorbed (workflow D, SC-08).
 */
export async function reconcilePeriod(tx: Tx, periodId: string, action: "change_request" | "absorbed", absorbReason?: string) {
  const p = await tx.one<PeriodRow>("select * from retainer_periods where id = $1", [periodId]);
  if (!p) throw new UserError("Period not found.");
  if (p.status === "reconciled") throw new UserError("Already reconciled.");
  const r = (await getRetainer(tx, p.retainer_id))!;
  const settings = await agencySettings(tx);
  if (p.ends_on >= todayIn(settings.timezone)) throw new UserError("Reconcile after the period ends.");
  const u = await periodUsage(tx, r.id, p.starts_on, p.ends_on);
  const allocated = p.allocated_hours + p.rollover_in_hours;
  const rec = reconcileRetainer({ allocatedHours: allocated, usedHours: u.hours, rollover: r.rollover, rolloverCapHours: r.rollover_cap_hours });
  let overageAction: "change_request" | "absorbed" | "none" = "none";
  if (rec.overageHours > 0) {
    overageAction = action;
    const rate = await blendedRate(tx, r.company_id, p.ends_on);
    const crId = await createChangeRequest(tx, {
      company_id: r.company_id,
      retainer_id: r.id,
      retainer_period_id: p.id,
      title: `Retainer overage ${formatShort(p.starts_on)}–${formatShort(p.ends_on)}: ${rec.overageHours}h`,
      description: `${u.hours}h delivered against ${allocated}h agreed for ${r.name}.`,
      origin: "retainer_overage",
      estimate_hours: rec.overageHours,
      price_cents: Math.round(rec.overageHours * rate),
    });
    if (action === "absorbed") {
      if (!absorbReason?.trim()) throw new UserError("Give a reason for absorbing the overage.");
      await tx.q("update change_requests set status = 'absorbed', absorb_reason = $2, decided_at = now(), decided_by = $3, decided_channel = 'app' where id = $1", [
        crId,
        absorbReason.trim(),
        tx.actorLabel,
      ]);
    }
  }
  await tx.q(
    `update retainer_periods set status = 'reconciled', used_hours = $2, overage_hours = $3, rollover_out_hours = $4, overage_action = $5, reconciled_at = now()
      where id = $1`,
    [periodId, u.hours, rec.overageHours, rec.rolloverOutHours, overageAction],
  );
  // Carry rollover into the next period if it already exists.
  await tx.q("update retainer_periods set rollover_in_hours = $3 where retainer_id = $1 and starts_on = $2", [r.id, addDays(p.ends_on, 1), rec.rolloverOutHours]);
  await tx.audit("retainer.reconciled", "retainer_period", periodId, undefined, { used: u.hours, allocated, ...rec, overageAction });
  return rec;
}

export async function retainerHistory(tx: Tx, retainerId: string) {
  const periods = await tx.q<PeriodRow>("select * from retainer_periods where retainer_id = $1 order by starts_on desc", [retainerId]);
  const out = [];
  for (const p of periods) {
    const u = await periodUsage(tx, retainerId, p.starts_on, p.ends_on);
    out.push({ ...p, live_used_hours: u.hours, labour_cost: Math.round(u.cost) });
  }
  return out;
}
