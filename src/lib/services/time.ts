import type { Tx } from "../db";
import { meetingsFor } from "../connectors/meetings";
import { todayIn } from "../domain/dates";
import { syncUnbilledTime, unbillTimeEntry } from "./billing";
import { agencySettings, rateFor, recordActivity, UserError } from "./core";
import { createChangeRequest } from "./scope";

export const TIME_CATEGORIES = [
  { key: "billable", label: "Billable" },
  { key: "non_billable_client", label: "Non-billable client" },
  { key: "new_business", label: "New business / pitch" },
  { key: "internal", label: "Internal" },
  { key: "training", label: "Training" },
  { key: "admin", label: "Admin" },
] as const;

export type TimeCategory = (typeof TIME_CATEGORIES)[number]["key"];

export interface LogTimeInput {
  job_id: string;
  task_id?: string | null;
  work_date: string;
  hours: number;
  category?: TimeCategory;
  notes?: string;
  source?: "timer" | "manual" | "suggestion" | "import";
  /** Required when the task is out of scope and has no change request yet. */
  oos_resolution?: "change_request" | "absorbed";
  absorb_reason?: string;
  closed_job_override?: string;
}

/**
 * Log time against a job (Rule 8). Rates are snapshotted so history never
 * changes, closed jobs need an override (M08), and out-of-scope work must be
 * sent as a change request or absorbed with a reason (M11 acceptance).
 */
export async function logTime(tx: Tx, userId: string, input: LogTimeInput) {
  if (!(input.hours > 0) || input.hours > 24) throw new UserError("Hours must be between 0 and 24.");
  const settings = await agencySettings(tx);
  if (settings.time_locked_until && input.work_date <= settings.time_locked_until) {
    throw new UserError(`Time up to ${settings.time_locked_until} is locked after month-end close.`);
  }
  const job = await tx.one<{ id: string; status: string; company_id: string; retainer_id: string | null; billing_model: string; name: string; bill_time: boolean }>(
    "select id, status, company_id, retainer_id, billing_model, name, bill_time from jobs where id = $1",
    [input.job_id],
  );
  if (!job) throw new UserError("Pick a job. All time sits on a job.");
  let notes = input.notes?.trim() ?? "";
  if (job.status === "closed") {
    if (!input.closed_job_override?.trim()) throw new UserError("This job is closed. Record an override reason to post time to it.");
    notes = `[closed-job override: ${input.closed_job_override.trim()}] ${notes}`;
    await tx.audit("time.closed_job_override", "job", job.id, undefined, { reason: input.closed_job_override });
  }
  const task = input.task_id
    ? await tx.one<{ id: string; job_id: string; scope_item_id: string | null; out_of_scope: boolean; change_request_id: string | null; title: string }>(
        "select id, job_id, scope_item_id, out_of_scope, change_request_id, title from tasks where id = $1",
        [input.task_id],
      )
    : null;
  if (task && task.job_id !== job.id) throw new UserError("That task belongs to another job.");

  const user = await tx.one<{ title: string; cost_rate_cents: number }>("select title, cost_rate_cents from users where id = $1", [userId]);
  const rate = await rateFor(tx, user!.title, job.company_id, input.work_date);
  const category: TimeCategory = input.category ?? (job.billing_model === "internal" ? "internal" : "billable");

  let outOfScope = false;
  let resolution: "change_request" | "absorbed" | null = null;
  let crId: string | null = null;
  let absorbReason: string | null = null;
  if (task?.out_of_scope) {
    outOfScope = true;
    if (task.change_request_id) {
      resolution = "change_request";
      crId = task.change_request_id;
    } else if (input.oos_resolution === "absorbed") {
      if (!input.absorb_reason?.trim()) throw new UserError("Say why this out-of-scope work is being absorbed.");
      resolution = "absorbed";
      absorbReason = input.absorb_reason.trim();
    } else if (input.oos_resolution === "change_request") {
      crId = await createChangeRequest(tx, {
        company_id: job.company_id,
        job_id: job.id,
        retainer_id: job.retainer_id,
        title: task.title,
        description: notes,
        origin: "time",
        estimate_hours: input.hours,
      });
      await tx.q("update tasks set change_request_id = $2 where id = $1", [task.id, crId]);
      resolution = "change_request";
    } else {
      throw new UserError("This task is out of scope. Send it as a change request or absorb it with a reason.");
    }
  }

  const row = await tx.one<{ id: string }>(
    `insert into time_entries (agency_id, user_id, job_id, task_id, scope_item_id, work_date, hours, category, notes, rate_cents, cost_cents,
                               out_of_scope, oos_resolution, change_request_id, absorb_reason, source)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id`,
    [
      tx.agencyId,
      userId,
      job.id,
      task?.id ?? null,
      task?.scope_item_id ?? null,
      input.work_date,
      Math.round(input.hours * 100) / 100,
      category,
      notes,
      rate,
      user!.cost_rate_cents,
      outOfScope,
      resolution,
      crId,
      absorbReason,
      input.source ?? "manual",
    ],
  );
  if (task) await tx.q("update tasks set last_activity_at = now() where id = $1", [task.id]);
  // Billable time goes straight onto the client's next invoice.
  if (job.bill_time) await syncUnbilledTime(tx, job.company_id);
  return row!.id;
}

export async function deleteTimeEntry(tx: Tx, userId: string, id: string) {
  const e = await tx.one<{ user_id: string; locked: boolean; invoice_line_id: string | null; hours: number }>("select user_id, locked, invoice_line_id, hours from time_entries where id = $1", [id]);
  if (!e) return;
  if (e.user_id !== userId) throw new UserError("You can only remove your own time.");
  if (e.locked) throw new UserError("This entry is locked after month-end close or invoicing.");
  // On a draft invoice: take the hours off it. On an issued one: refused inside.
  if (e.invoice_line_id) await unbillTimeEntry(tx, { hours: e.hours, invoice_line_id: e.invoice_line_id });
  await tx.q("delete from time_entries where id = $1", [id]);
}

// ───────────────────────── Timer (M09 focus mode) ─────────────────────────

export async function startTimer(tx: Tx, userId: string, jobId: string, taskId: string | null) {
  const running = await stopTimer(tx, userId);
  await tx.q(
    `insert into timers (user_id, agency_id, job_id, task_id, started_at) values ($1,$2,$3,$4,now())
     on conflict (user_id) do update set job_id = excluded.job_id, task_id = excluded.task_id, started_at = now()`,
    [userId, tx.agencyId, jobId, taskId],
  );
  if (taskId) {
    await tx.q("update tasks set status = case when status in ('todo','blocked') then 'in_progress' else status end, last_activity_at = now() where id = $1", [taskId]);
  }
  await recordActivity(tx, "timer.start", { jobId, taskId });
  return running;
}

/** Stop the running timer and log the time. Short sessions (< 3 min) are dropped. */
export async function stopTimer(tx: Tx, userId: string, opts: Partial<Pick<LogTimeInput, "oos_resolution" | "absorb_reason">> = {}) {
  const t = await tx.one<{ job_id: string; task_id: string | null; started_at: Date }>("select job_id, task_id, started_at from timers where user_id = $1", [userId]);
  if (!t) return null;
  await tx.q("delete from timers where user_id = $1", [userId]);
  const hours = Math.round(((Date.now() - new Date(t.started_at).getTime()) / 3_600_000) * 20) / 20; // nearest 3 minutes
  if (hours < 0.05) return null;
  const settings = await agencySettings(tx);
  const task = t.task_id ? await tx.one<{ out_of_scope: boolean; change_request_id: string | null }>("select out_of_scope, change_request_id from tasks where id = $1", [t.task_id]) : null;
  // An out-of-scope task without a change request: keep the time honest by drafting one.
  const resolution = task?.out_of_scope && !task.change_request_id ? opts.oos_resolution ?? "change_request" : undefined;
  return logTime(tx, userId, {
    job_id: t.job_id,
    task_id: t.task_id,
    work_date: todayIn(settings.timezone),
    hours: Math.min(hours, 12),
    source: "timer",
    oos_resolution: resolution,
    absorb_reason: opts.absorb_reason,
  });
}

export async function currentTimer(tx: Tx, userId: string) {
  return tx.one<{ job_id: string; task_id: string | null; started_at: Date; job_number: string; task_title: string | null }>(
    `select t.job_id, t.task_id, t.started_at, j.number as job_number, k.title as task_title
       from timers t join jobs j on j.id = t.job_id left join tasks k on k.id = t.task_id where t.user_id = $1`,
    [userId],
  );
}

// ───────────────────────── Pre-filled timesheets ─────────────────────────

export interface TimeSuggestion {
  job_id: string;
  task_id: string | null;
  job_number: string;
  job_name: string;
  task_title: string | null;
  hours: number;
  reason: string;
  out_of_scope: boolean;
  has_change_request: boolean;
  /** Pre-filled time note (meeting titles), so the entry says what it was. */
  notes?: string;
}

/**
 * Build suggested entries for a day from the person's own activity in 8gency
 * (task updates, uploads, reviews, timers). Shown only to that person until
 * confirmed, never to managers (TT-07). Unlogged hours up to their standard day
 * are split by how much activity each task had.
 */
export async function timesheetSuggestions(tx: Tx, userId: string, date: string): Promise<TimeSuggestion[]> {
  const user = await tx.one<{ weekly_hours: number }>("select weekly_hours from users where id = $1", [userId]);
  const dayHours = (user?.weekly_hours ?? 40) / 5;
  const logged = await tx.q<{ job_id: string; task_id: string | null; hours: number }>(
    "select job_id, task_id, sum(hours) as hours from time_entries where user_id = $1 and work_date = $2 group by job_id, task_id",
    [userId, date],
  );
  const loggedTotal = logged.reduce((s, r) => s + r.hours, 0);
  const loggedJobs = new Set(logged.map((l) => l.job_id));

  // Meetings from the person's connected calendar or Zoom, already matched to a job.
  const meetingRows = (await meetingsFor(tx, userId, date)).filter((m) => !loggedJobs.has(m.job_id));
  const byJob = new Map<string, { minutes: number; titles: string[]; sources: Set<string> }>();
  for (const m of meetingRows) {
    const g = byJob.get(m.job_id) ?? { minutes: 0, titles: [], sources: new Set<string>() };
    g.minutes += m.minutes;
    g.titles.push(m.title);
    g.sources.add(m.source);
    byJob.set(m.job_id, g);
  }
  const meetingJobs = byJob.size
    ? await tx.q<{ id: string; number: string; name: string }>("select id, number, name from jobs where id = any($1)", [[...byJob.keys()]])
    : [];
  const meetings: TimeSuggestion[] = meetingJobs.map((j) => {
    const g = byJob.get(j.id)!;
    return {
      job_id: j.id,
      task_id: null,
      job_number: j.number,
      job_name: j.name,
      task_title: null,
      hours: Math.max(0.25, Math.round((g.minutes / 60) * 4) / 4),
      reason: `had ${g.titles.length > 1 ? `${g.titles.length} meetings (${g.minutes} min)` : `a ${g.minutes}-min meeting`}: ${g.titles.join(", ")} (${[...g.sources].join(", ")})`,
      out_of_scope: false,
      has_change_request: false,
      notes: g.titles.join("; ").slice(0, 300),
    };
  });

  const remaining = Math.max(0, dayHours - loggedTotal - meetings.reduce((s, m) => s + m.hours, 0));
  if (remaining < 0.25) return meetings;

  const activity = await tx.q<{ job_id: string; task_id: string | null; n: number; kinds: string[] }>(
    `select a.job_id, a.task_id, count(*)::int as n, array_agg(distinct a.kind) as kinds
       from activity_events a
       join jobs j on j.id = a.job_id and j.status <> 'closed'
      where a.user_id = $1 and a.job_id is not null
        and (a.at at time zone (select timezone from agencies where id = a.agency_id))::date = $2
      group by a.job_id, a.task_id`,
    [userId, date],
  );
  const loggedKeys = new Set(logged.map((l) => `${l.job_id}:${l.task_id ?? ""}`));
  const candidates = activity.filter((a) => !loggedKeys.has(`${a.job_id}:${a.task_id ?? ""}`) && !(byJob.has(a.job_id) && !a.task_id));
  if (!candidates.length) return meetings;
  const totalWeight = candidates.reduce((s, c) => s + c.n, 0);

  const meta = await tx.q<{ job_id: string; task_id: string | null; job_number: string; job_name: string; task_title: string | null; out_of_scope: boolean; change_request_id: string | null }>(
    `select j.id as job_id, t.id as task_id, j.number as job_number, j.name as job_name, t.title as task_title,
            coalesce(t.out_of_scope,false) as out_of_scope, t.change_request_id
       from jobs j left join tasks t on t.job_id = j.id and t.id = any($2::uuid[])
      where j.id = any($1::uuid[])`,
    [candidates.map((c) => c.job_id), candidates.map((c) => c.task_id).filter(Boolean)],
  );
  const label: Record<string, string> = {
    "timer.start": "timer started",
    "task.in_progress": "worked on task",
    "task.done": "completed task",
    "task.blocked": "updated task",
    "version.uploaded": "uploaded a version",
    "review.internal": "reviewed work",
    "feedback.added": "left feedback",
    "deliverable.sent": "sent for client review",
  };
  const fromActivity = candidates
    .map((c) => {
      const m = meta.find((x) => x.job_id === c.job_id && (x.task_id ?? null) === (c.task_id ?? null)) ?? meta.find((x) => x.job_id === c.job_id)!;
      // Split the unlogged part of the day by activity, but never suggest more
      // than the evidence supports (about half an hour per recorded action).
      const share = (remaining * c.n) / totalWeight;
      const hours = Math.max(0.25, Math.round(Math.min(share, c.n * 0.5) * 4) / 4);
      return {
        job_id: c.job_id,
        task_id: c.task_id,
        job_number: m?.job_number ?? "",
        job_name: m?.job_name ?? "",
        task_title: c.task_id ? m?.task_title ?? null : null,
        hours,
        reason: c.kinds.map((k) => label[k] ?? k).join(", "),
        out_of_scope: Boolean(c.task_id && m?.out_of_scope),
        has_change_request: Boolean(m?.change_request_id),
      };
    })
    .sort((a, b) => b.hours - a.hours);
  return [...meetings, ...fromActivity];
}

export async function weekEntries(tx: Tx, userId: string, from: string, to: string) {
  return tx.q<{
    id: string; work_date: string; hours: number; category: string; notes: string; job_id: string; job_number: string; job_name: string;
    task_title: string | null; out_of_scope: boolean; oos_resolution: string | null; locked: boolean; source: string; invoice_line_id: string | null;
    /** Status of the invoice this time is on, if any ("draft" = the client's next invoice). */
    invoice_status: string | null;
  }>(
    `select te.id, te.work_date, te.hours, te.category, te.notes, te.job_id, j.number as job_number, j.name as job_name,
            t.title as task_title, te.out_of_scope, te.oos_resolution, te.locked, te.source, te.invoice_line_id, i.status as invoice_status
       from time_entries te join jobs j on j.id = te.job_id left join tasks t on t.id = te.task_id
       left join invoice_lines l on l.id = te.invoice_line_id left join invoices i on i.id = l.invoice_id
      where te.user_id = $1 and te.work_date between $2 and $3
      order by te.work_date, te.created_at`,
    [userId, from, to],
  );
}

/** Month-end close (workflow E): lock all time up to a date. */
export async function lockTimeUntil(tx: Tx, date: string) {
  await tx.q("update time_entries set locked = true where work_date <= $1 and not locked", [date]);
  await tx.q("update agencies set time_locked_until = $2 where id = $1", [tx.agencyId, date]);
  await tx.audit("time.locked", "agency", tx.agencyId, undefined, { until: date });
}

/** Days with confirmed time ÷ working days, per person (timesheet compliance). */
export async function timesheetCompliance(tx: Tx, from: string, to: string) {
  return tx.q<{ user_id: string; name: string; days_logged: number; hours: number }>(
    `select u.id as user_id, u.name, count(distinct te.work_date)::int as days_logged, coalesce(sum(te.hours),0) as hours
       from users u left join time_entries te on te.user_id = u.id and te.work_date between $1 and $2
            and extract(isodow from te.work_date) < 6
      where u.active group by u.id, u.name order by u.name`,
    [from, to],
  );
}
