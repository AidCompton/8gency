import type { Tx } from "../db";
import { scoreBrief } from "../domain/brief";
import { addDays, todayIn } from "../domain/dates";
import { formatJobNumber } from "../domain/jobNumber";
import { projectMargin } from "../domain/metrics";
import { jobTemplate } from "../templates";
import { agencySettings, nextCounter, notify, recordActivity, UserError, usersWithRoles } from "./core";

export type JobStatus = "briefing" | "in_progress" | "waiting_client" | "complete" | "closed";

export interface JobRow {
  id: string;
  company_id: string;
  retainer_id: string | null;
  number: string;
  name: string;
  job_type: string;
  status: JobStatus;
  billing_model: "fixed" | "tm" | "retainer" | "internal";
  owner_id: string | null;
  account_manager_id: string | null;
  start_date: string | null;
  due_date: string | null;
  budget_hours: number;
  fee_cents: number;
  rush: boolean;
  brief_override_reason: string | null;
  scope_locked_at: Date | null;
  completed_at: Date | null;
  closed_at: Date | null;
  closeout_on_time: boolean | null;
  closeout_on_budget: boolean | null;
  closeout_rating: number | null;
  closeout_lessons: string | null;
  created_at: Date;
}

export interface CreateJobInput {
  company_id: string;
  name: string;
  template_key?: string;
  billing_model?: JobRow["billing_model"];
  retainer_id?: string | null;
  owner_id?: string | null;
  account_manager_id?: string | null;
  start_date?: string | null;
  due_date?: string | null;
  budget_hours?: number;
  fee_cents?: number;
  rush?: boolean;
  assignee_id?: string | null;
}

/** Rule 1: no work without a job. Every job gets a number, a client and an owner. */
export async function createJob(tx: Tx, input: CreateJobInput): Promise<string> {
  const settings = await agencySettings(tx);
  const company = await tx.one<{ code: string; account_manager_id: string | null }>(
    "select code, account_manager_id from companies where id = $1",
    [input.company_id],
  );
  if (!company) throw new UserError("Choose a client for the job.");
  if (!input.name.trim()) throw new UserError("Give the job a name.");
  const tpl = jobTemplate(input.template_key) ?? jobTemplate("blank")!;
  const today = todayIn(settings.timezone);
  const start = input.start_date || today;
  const due = input.due_date || addDays(start, tpl.durationDays);
  const year = Number(start.slice(0, 4));
  const seq = await nextCounter(tx, `job:${year}`);
  const number = formatJobNumber(settings.job_number_format, { client: company.code, year, seq });
  const billing = input.billing_model ?? (input.retainer_id ? "retainer" : tpl.billingModel);
  const budgetHours = input.budget_hours ?? tpl.tasks.reduce((s, t) => s + t.estimate, 0);

  const job = (await tx.one<{ id: string }>(
    `insert into jobs (agency_id, company_id, retainer_id, number, name, job_type, billing_model, owner_id, account_manager_id,
                       start_date, due_date, budget_hours, fee_cents, rush)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
    [
      tx.agencyId,
      input.company_id,
      input.retainer_id ?? null,
      number,
      input.name.trim(),
      tpl.jobType,
      billing,
      input.owner_id ?? tx.userId,
      input.account_manager_id ?? company.account_manager_id ?? tx.userId,
      start,
      due,
      budgetHours,
      input.fee_cents ?? 0,
      input.rush ?? false,
    ],
  ))!;

  await tx.q("insert into briefs (agency_id, job_id, deadline) values ($1,$2,$3)", [tx.agencyId, job.id, due]);

  const scopeIds: string[] = [];
  for (const s of tpl.scope) {
    const row = await tx.one<{ id: string }>(
      `insert into scope_items (agency_id, company_id, job_id, name, unit, quantity, rounds_allowed, inclusions, exclusions)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [tx.agencyId, input.company_id, job.id, s.name, s.unit, s.quantity, s.rounds, s.inclusions ?? "", s.exclusions ?? ""],
    );
    scopeIds.push(row!.id);
  }
  for (const t of tpl.tasks) {
    const dueDate = t.offsetDays < 0 ? addDays(due, t.offsetDays) : addDays(start, t.offsetDays);
    await tx.q(
      `insert into tasks (agency_id, job_id, scope_item_id, title, assignee_id, due_date, estimate_hours)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [tx.agencyId, job.id, t.scopeIndex !== undefined ? scopeIds[t.scopeIndex] : null, t.title, input.assignee_id ?? null, dueDate > due ? due : dueDate, t.estimate],
    );
  }
  if (billing === "fixed" && (input.fee_cents ?? 0) > 0) {
    const ms = tpl.milestones ?? [{ name: "On completion", share: 1, trigger: "completion" as const }];
    let allocated = 0;
    for (const [i, m] of ms.entries()) {
      const amount = i === ms.length - 1 ? input.fee_cents! - allocated : Math.round(input.fee_cents! * m.share);
      allocated += amount;
      await tx.q(
        "insert into milestones (agency_id, job_id, name, amount_cents, trigger, due_date, sort) values ($1,$2,$3,$4,$5,$6,$7)",
        [tx.agencyId, job.id, m.name, amount, m.trigger, m.trigger === "start" ? start : m.trigger === "completion" ? due : null, i],
      );
    }
  }
  await tx.audit("job.created", "job", job.id, undefined, { number, name: input.name, billing_model: billing, fee_cents: input.fee_cents ?? 0 });
  return job.id;
}

export async function getJob(tx: Tx, id: string) {
  return tx.one<JobRow & { company_name: string; company_code: string; owner_name: string | null; am_name: string | null; retainer_name: string | null }>(
    `select j.*, c.name as company_name, c.code as company_code, o.name as owner_name, am.name as am_name, r.name as retainer_name
       from jobs j join companies c on c.id = j.company_id
       left join users o on o.id = j.owner_id
       left join users am on am.id = j.account_manager_id
       left join retainers r on r.id = j.retainer_id
      where j.id = $1`,
    [id],
  );
}

/** Lock the scope baseline: from now on scope only grows through change requests (PR-10). */
export async function lockScope(tx: Tx, jobId: string) {
  const items = await tx.one<{ n: number }>("select count(*)::int as n from scope_items where job_id = $1", [jobId]);
  if (!items?.n) throw new UserError("Add at least one scope item before approving the scope baseline.");
  await tx.q("update jobs set scope_locked_at = now() where id = $1 and scope_locked_at is null", [jobId]);
  await tx.audit("scope.locked", "job", jobId);
}

export async function briefScoreFor(tx: Tx, jobId: string) {
  const brief = await tx.one<Record<string, string | null>>("select * from briefs where job_id = $1", [jobId]);
  return scoreBrief(brief ?? {});
}

/**
 * Move a job through its lifecycle, enforcing the operating rules:
 *  - Rule 2: no job without an approved scope (internal jobs excepted).
 *  - Rule 3 / M07: no "in progress" below the brief threshold without a recorded override.
 *  - Rule 15: closing needs a close-out review (see closeJob).
 */
export async function setJobStatus(tx: Tx, jobId: string, status: JobStatus, opts: { overrideReason?: string } = {}) {
  const job = await getJob(tx, jobId);
  if (!job) throw new UserError("Job not found.");
  if (status === "closed") throw new UserError("Use the close-out review to close a job.");
  const settings = await agencySettings(tx);

  if (status === "in_progress" && job.status === "briefing") {
    if (job.billing_model !== "internal" && !job.scope_locked_at) {
      throw new UserError("Approve the scope baseline before work starts (no job without an approved scope).");
    }
    const { score } = await briefScoreFor(tx, jobId);
    if (score < settings.brief_threshold && !job.brief_override_reason) {
      const reason = opts.overrideReason?.trim();
      if (!reason) {
        throw new UserError(`The brief scores ${score}/100, below the agency threshold of ${settings.brief_threshold}. Complete the brief or record an override reason.`);
      }
      await tx.q("update jobs set brief_override_reason = $2, brief_override_by = $3 where id = $1", [jobId, reason, tx.actorLabel]);
      await tx.audit("brief.override", "job", jobId, { score }, { reason });
    }
  }

  await tx.q(
    `update jobs set status = $2,
            completed_at = case when $2 = 'complete' then coalesce(completed_at, now()) else completed_at end
      where id = $1`,
    [jobId, status],
  );
  await tx.audit("job.status", "job", jobId, { status: job.status }, { status });

  // Milestone triggers feed the ready-to-bill queue and tell finance (FN-01).
  const trigger = status === "in_progress" ? "start" : status === "complete" ? "completion" : null;
  if (trigger) {
    const done = await tx.q<{ id: string; name: string }>(
      "update milestones set status = 'complete', completed_at = now() where job_id = $1 and trigger = $2 and status = 'pending' returning id, name",
      [jobId, trigger],
    );
    if (done.length) {
      const finance = await usersWithRoles(tx, ["finance", "owner"]);
      for (const m of done) {
        await notify(tx, finance, {
          kind: "ready_to_bill",
          title: `Ready to bill: ${job.number} ${m.name}`,
          body: `${job.company_name} · ${job.name}`,
          href: "/app/billing",
          dedupe: `milestone:${m.id}`,
        });
      }
    }
  }
}

export async function completeMilestone(tx: Tx, milestoneId: string) {
  const m = await tx.one<{ job_id: string; name: string }>(
    "update milestones set status = 'complete', completed_at = now() where id = $1 and status = 'pending' returning job_id, name",
    [milestoneId],
  );
  if (!m) return;
  await tx.audit("milestone.completed", "milestone", milestoneId, undefined, m);
  const finance = await usersWithRoles(tx, ["finance", "owner"]);
  await notify(tx, finance, { kind: "ready_to_bill", title: `Ready to bill: ${m.name}`, href: "/app/billing", dedupe: `milestone:${milestoneId}` });
}

export async function closeJob(
  tx: Tx,
  jobId: string,
  c: { on_time: boolean; on_budget: boolean; rating: number | null; lessons: string },
) {
  if (!c.lessons.trim()) throw new UserError("Add the lessons learned before closing the job.");
  const job = await getJob(tx, jobId);
  if (!job) throw new UserError("Job not found.");
  if (job.status !== "complete") throw new UserError("Mark the job complete before the close-out review.");
  await tx.q(
    `update jobs set status = 'closed', closed_at = now(), closeout_on_time = $2, closeout_on_budget = $3,
            closeout_rating = $4, closeout_lessons = $5 where id = $1`,
    [jobId, c.on_time, c.on_budget, c.rating, c.lessons.trim()],
  );
  await tx.q("delete from timers where job_id = $1", [jobId]);
  await tx.audit("job.closed", "job", jobId, { status: job.status }, c);
}

export async function addTask(
  tx: Tx,
  input: { job_id: string; title: string; assignee_id?: string | null; due_date?: string | null; estimate_hours?: number; scope_item_id?: string | null; out_of_scope?: boolean; change_request_id?: string | null; notes?: string },
) {
  if (!input.title.trim()) throw new UserError("Task title is required.");
  const job = await tx.one<{ status: string }>("select status from jobs where id = $1", [input.job_id]);
  if (job?.status === "closed") throw new UserError("This job is closed.");
  const row = await tx.one<{ id: string }>(
    `insert into tasks (agency_id, job_id, title, assignee_id, due_date, estimate_hours, scope_item_id, out_of_scope, change_request_id, notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [
      tx.agencyId,
      input.job_id,
      input.title.trim(),
      input.assignee_id || null,
      input.due_date || null,
      input.estimate_hours ?? 0,
      input.scope_item_id || null,
      input.out_of_scope ?? false,
      input.change_request_id ?? null,
      input.notes ?? "",
    ],
  );
  if (input.assignee_id && input.assignee_id !== tx.userId) {
    await notify(tx, [input.assignee_id], { kind: "task_assigned", title: `New task: ${input.title}`, href: "/app/my-day", dedupe: `assign:${row!.id}` });
  }
  return row!.id;
}

export async function setTaskStatus(tx: Tx, taskId: string, status: string, blockedReason?: string) {
  const task = await tx.one<{ job_id: string; status: string }>(
    `update tasks set status = $2, blocked_reason = $3, last_activity_at = now(),
            completed_at = case when $2 = 'done' then now() else null end
      where id = $1 returning job_id, status`,
    [taskId, status, status === "blocked" ? blockedReason ?? "" : null],
  );
  if (task) await recordActivity(tx, `task.${status}`, { jobId: task.job_id, taskId });
}

export interface JobFinancials {
  hoursUsed: number;
  billableHours: number;
  budgetHours: number;
  hoursBurn: number | null;
  labourCost: number;
  standardValue: number;
  revenue: number;
  directCosts: number;
  rebillableCosts: number;
  margin: number | null;
  forecastHours: number;
  absorbedValue: number;
  approvedChangeValue: number;
  invoiced: number;
}

/**
 * Money on every screen (principle 2). Revenue is the fee plus approved change
 * requests for fixed jobs, time at standard rates for T&M, and a share of the
 * retainer fee by hours for retainer jobs.
 */
export async function jobFinancials(tx: Tx, jobId: string): Promise<JobFinancials> {
  const j = await tx.one<{ billing_model: string; fee_cents: number; budget_hours: number; retainer_id: string | null; status: string }>(
    "select billing_model, fee_cents, budget_hours, retainer_id, status from jobs where id = $1",
    [jobId],
  );
  if (!j) throw new UserError("Job not found.");
  const t = (await tx.one<{ hours: number; billable: number; cost: number; value: number }>(
    `select coalesce(sum(hours),0) as hours,
            coalesce(sum(hours) filter (where category = 'billable'),0) as billable,
            coalesce(sum(hours * cost_cents),0) as cost,
            coalesce(sum(hours * rate_cents) filter (where category = 'billable'),0) as value
       from time_entries where job_id = $1`,
    [jobId],
  ))!;
  const cr = (await tx.one<{ approved: number; absorbed: number }>(
    `select coalesce(sum(price_cents) filter (where status = 'approved'),0) as approved,
            coalesce(sum(price_cents) filter (where status = 'absorbed'),0) as absorbed
       from change_requests where job_id = $1`,
    [jobId],
  ))!;
  const absorbedTime = (await tx.one<{ v: number }>(
    "select coalesce(sum(hours * rate_cents),0) as v from time_entries where job_id = $1 and oos_resolution = 'absorbed'",
    [jobId],
  ))!;
  const costs = (await tx.one<{ direct: number; rebill: number }>(
    `select coalesce(sum(amount_cents),0) as direct,
            coalesce(sum(round(amount_cents * (1 + markup))) filter (where rebillable),0) as rebill
       from costs where job_id = $1`,
    [jobId],
  ))!;
  const invoiced = (await tx.one<{ v: number }>(
    `select coalesce(sum(l.amount_cents),0) as v from invoice_lines l join invoices i on i.id = l.invoice_id
      where l.job_id = $1 and i.status in ('sent','paid')`,
    [jobId],
  ))!;
  const openTasks = (await tx.one<{ remaining: number }>(
    `select coalesce(sum(greatest(t.estimate_hours - coalesce(te.h,0), 0)),0) as remaining
       from tasks t left join (select task_id, sum(hours) h from time_entries group by task_id) te on te.task_id = t.id
      where t.job_id = $1 and t.status <> 'done'`,
    [jobId],
  ))!;

  let revenue = 0;
  if (j.billing_model === "fixed") revenue = j.fee_cents + cr.approved;
  else if (j.billing_model === "tm") revenue = Math.round(t.value) + cr.approved;
  else if (j.billing_model === "retainer" && j.retainer_id) {
    const r = await tx.one<{ fee_cents: number; hours_per_period: number }>("select fee_cents, hours_per_period from retainers where id = $1", [j.retainer_id]);
    const perHour = r && r.hours_per_period > 0 ? r.fee_cents / r.hours_per_period : 0;
    revenue = Math.round(t.hours * perHour) + cr.approved;
  }
  revenue += costs.rebill;
  const labour = Math.round(t.cost);
  return {
    hoursUsed: t.hours,
    billableHours: t.billable,
    budgetHours: j.budget_hours,
    hoursBurn: j.budget_hours > 0 ? t.hours / j.budget_hours : null,
    labourCost: labour,
    standardValue: Math.round(t.value),
    revenue,
    directCosts: costs.direct,
    rebillableCosts: costs.rebill,
    margin: projectMargin(revenue, labour, costs.direct),
    forecastHours: t.hours + (j.status === "complete" || j.status === "closed" ? 0 : openTasks.remaining),
    absorbedValue: cr.absorbed + Math.round(absorbedTime.v),
    approvedChangeValue: cr.approved,
    invoiced: invoiced.v,
  };
}

/** Traffic view: every live job with status, owner, next deadline and budget burn (M08 acceptance). */
export async function listJobs(tx: Tx, filter: { status?: string; companyId?: string; userId?: string; includeClosed?: boolean } = {}) {
  return tx.q<{
    id: string; number: string; name: string; status: JobStatus; billing_model: string; company_name: string; company_id: string;
    owner_name: string | null; due_date: string | null; budget_hours: number; hours_used: number; next_due: string | null;
    open_tasks: number; blocked: number; waiting_client: number; rush: boolean; fee_cents: number;
  }>(
    `select j.id, j.number, j.name, j.status, j.billing_model, j.due_date, j.budget_hours, j.rush, j.fee_cents,
            c.name as company_name, c.id as company_id, u.name as owner_name,
            coalesce((select sum(hours) from time_entries te where te.job_id = j.id),0) as hours_used,
            (select min(due_date) from tasks t where t.job_id = j.id and t.status <> 'done') as next_due,
            (select count(*)::int from tasks t where t.job_id = j.id and t.status <> 'done') as open_tasks,
            (select count(*)::int from tasks t where t.job_id = j.id and t.status = 'blocked') as blocked,
            (select count(*)::int from deliverables d where d.job_id = j.id and d.status = 'client_review') as waiting_client
       from jobs j join companies c on c.id = j.company_id left join users u on u.id = j.owner_id
      where ($1::text is null or j.status = $1)
        and ($2::uuid is null or j.company_id = $2)
        and ($3::uuid is null or j.owner_id = $3 or j.account_manager_id = $3
             or exists (select 1 from tasks t where t.job_id = j.id and t.assignee_id = $3))
        and ($4 or j.status <> 'closed')
      order by case j.status when 'in_progress' then 0 when 'waiting_client' then 1 when 'briefing' then 2 when 'complete' then 3 else 4 end,
               coalesce(j.due_date, '9999-12-31')`,
    [filter.status ?? null, filter.companyId ?? null, filter.userId ?? null, filter.includeClosed ?? false],
  );
}
