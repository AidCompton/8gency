import { activeConnection } from "../connectors/connections";
import type { Tx } from "../db";
import { BUILTINS, actionDef, triggerDef, type Condition, type Step } from "../domain/automations";
import { addDays, daysBetween, todayIn } from "../domain/dates";
import { formatMoney } from "../domain/money";
import { firstName } from "../domain/text";
import { agencySettings, appUrl, ensureHubToken, notify, queueMessage, usersWithRoles } from "./core";

// Runs custom automations (trigger → filters → actions) built in /app/automations.
// Kept free of other service imports so any service can fire events into it.
// Steps that reach outside 8gency only queue: the connector worker delivers.

type RecordType = "job" | "deliverable" | "invoice" | "change_request" | "client_request" | "task";

interface Ctx {
  record_type: RecordType;
  record_id: string;
  company_id: string | null;
  company_name: string;
  job_id: string | null;
  job_label: string;
  owner_id: string | null;
  account_manager_id: string | null;
  assignee_id: string | null;
  billing_model: string | null;
  amount_cents: number | null;
  currency: string;
  item: string;
  href: string;
  status: string | null;
  days?: number;
  percent?: number;
}

interface AutomationRow {
  id: string;
  name: string;
  trigger: Step;
  filters: Condition[];
  actions: Step[];
}

const RECORD_SQL: Record<RecordType, string> = {
  job: `select 'job' as record_type, j.id as record_id, j.company_id, co.name as company_name, j.id as job_id, j.number || ' ' || j.name as job_label,
               j.owner_id, coalesce(j.account_manager_id, co.account_manager_id) as account_manager_id, null::uuid as assignee_id, j.billing_model,
               nullif(j.fee_cents, 0) as amount_cents, co.currency, j.number || ' ' || j.name as item, '/app/jobs/' || j.id as href, j.status
          from jobs j join companies co on co.id = j.company_id where j.id = $1`,
  deliverable: `select 'deliverable' as record_type, d.id as record_id, j.company_id, co.name as company_name, j.id as job_id, j.number || ' ' || j.name as job_label,
               j.owner_id, coalesce(j.account_manager_id, co.account_manager_id) as account_manager_id, null::uuid as assignee_id, j.billing_model,
               null::bigint as amount_cents, co.currency, d.name as item, '/app/deliverables/' || d.id as href, d.status
          from deliverables d join jobs j on j.id = d.job_id join companies co on co.id = j.company_id where d.id = $1`,
  invoice: `select 'invoice' as record_type, i.id as record_id, i.company_id, co.name as company_name, null::uuid as job_id, '' as job_label,
               null::uuid as owner_id, co.account_manager_id, null::uuid as assignee_id, null as billing_model,
               i.total_cents as amount_cents, i.currency, coalesce(i.number, 'draft invoice') as item, '/app/billing/invoices/' || i.id as href, i.status
          from invoices i join companies co on co.id = i.company_id where i.id = $1`,
  change_request: `select 'change_request' as record_type, cr.id as record_id, cr.company_id, co.name as company_name, j.id as job_id, coalesce(j.number || ' ' || j.name, '') as job_label,
               j.owner_id, coalesce(j.account_manager_id, co.account_manager_id) as account_manager_id, null::uuid as assignee_id, j.billing_model,
               cr.price_cents as amount_cents, co.currency, cr.title as item, '/app/scope/' || cr.id as href, cr.status
          from change_requests cr join companies co on co.id = cr.company_id left join jobs j on j.id = cr.job_id where cr.id = $1`,
  client_request: `select 'client_request' as record_type, r.id as record_id, r.company_id, co.name as company_name, j.id as job_id, coalesce(j.number || ' ' || j.name, '') as job_label,
               j.owner_id, co.account_manager_id, null::uuid as assignee_id, j.billing_model,
               null::bigint as amount_cents, co.currency, left(regexp_replace(r.body, '\\s+', ' ', 'g'), 80) as item, '/app/scope' as href, r.status
          from client_requests r join companies co on co.id = r.company_id left join jobs j on j.id = r.job_id where r.id = $1`,
  task: `select 'task' as record_type, t.id as record_id, j.company_id, co.name as company_name, j.id as job_id, j.number || ' ' || j.name as job_label,
               j.owner_id, coalesce(j.account_manager_id, co.account_manager_id) as account_manager_id, t.assignee_id, j.billing_model,
               null::bigint as amount_cents, co.currency, t.title as item, '/app/jobs/' || j.id || '?tab=tasks' as href, t.status
          from tasks t join jobs j on j.id = t.job_id join companies co on co.id = j.company_id where t.id = $1`,
};

function recordTypeOf(trigger: string): RecordType {
  if (trigger.startsWith("job.") || trigger === "schedule.budget_burn") return "job";
  if (trigger.startsWith("deliverable.") || trigger === "schedule.deliverable_waiting") return "deliverable";
  if (trigger.startsWith("invoice.") || trigger === "schedule.invoice_overdue") return "invoice";
  if (trigger.startsWith("change_request.")) return "change_request";
  if (trigger.startsWith("client_request.")) return "client_request";
  return "task";
}

const loadContext = (tx: Tx, type: RecordType, id: string) => tx.one<Ctx>(RECORD_SQL[type], [id]);

function triggerMatches(trigger: Step, ctx: Ctx) {
  if (trigger.type === "job.status_changed" && trigger.config.to && trigger.config.to !== "any") return ctx.status === trigger.config.to;
  return true;
}

function passes(filters: Condition[], ctx: Ctx) {
  return filters.every((f) => {
    if (!f.value) return true;
    if (f.field === "company_id") return ctx.company_id === f.value;
    if (f.field === "billing_model") return ctx.billing_model === f.value;
    if (f.field === "min_amount") return (ctx.amount_cents ?? 0) >= Math.round(Number(f.value) * 100);
    return true;
  });
}

const render = (text: unknown, vars: Record<string, string>) => String(text ?? "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? "");

/** Hub page for the record, so a client message links straight to what it's about. */
function hubPath(ctx: Ctx) {
  if (ctx.record_type === "deliverable") return `/review/${ctx.record_id}`;
  if (ctx.record_type === "invoice") return `/invoices/${ctx.record_id}`;
  if (ctx.record_type === "change_request") return `/change/${ctx.record_id}`;
  return "";
}

async function clientContacts(tx: Tx, ctx: Ctx, who: string) {
  type C = { id: string; name: string; email: string; phone: string };
  if (!ctx.company_id) return [];
  if (who === "all") return tx.q<C>("select id, name, email, phone from contacts where company_id = $1 and active order by created_at", [ctx.company_id]);
  if (who === "billing") return tx.q<C>("select id, name, email, phone from contacts where company_id = $1 and role = 'billing' and active order by created_at", [ctx.company_id]);
  // Approver: the deliverable's, else the job brief's, else the client's first approver.
  const named =
    ctx.record_type === "deliverable"
      ? await tx.one<{ id: string }>("select approver_contact_id as id from deliverables where id = $1", [ctx.record_id])
      : ctx.job_id
        ? await tx.one<{ id: string }>("select approver_contact_id as id from briefs where job_id = $1", [ctx.job_id])
        : null;
  if (named?.id) return tx.q<C>("select id, name, email, phone from contacts where id = $1 and active", [named.id]);
  return tx.q<C>("select id, name, email, phone from contacts where company_id = $1 and role = 'approver' and active order by created_at limit 1", [ctx.company_id]);
}

async function teamIds(tx: Tx, ctx: Ctx, who: string): Promise<(string | null)[]> {
  if (who === "job_owner") return [ctx.owner_id];
  if (who === "account_manager") return [ctx.account_manager_id];
  if (who === "assignee") return [ctx.assignee_id];
  if (who === "finance") return usersWithRoles(tx, ["finance"]);
  if (who === "owner") return usersWithRoles(tx, ["owner"]);
  if (who === "ops") return usersWithRoles(tx, ["ops"]);
  return [];
}

async function execute(tx: Tx, a: AutomationRow, step: Step, ctx: Ctx, vars: Record<string, string>, n: number, recordKey: string): Promise<string> {
  const def = actionDef(step.type);
  if (!def) throw new Error(`Unknown action "${step.type}".`);
  const c = step.config;
  if (step.type === "notify") {
    const ids = [...new Set((await teamIds(tx, ctx, String(c.to))).filter(Boolean))] as string[];
    if (!ids.length) return `No ${String(c.to).replace(/_/g, " ")} to notify`;
    await notify(tx, ids, { kind: "automation", title: render(c.message, vars) || a.name, body: a.name, href: ctx.href, dedupe: `auto:${a.id}:${recordKey}:${n}` });
    return `Notified ${ids.length} ${ids.length === 1 ? "person" : "people"}`;
  }
  if (step.type === "gmail_send" && !(await activeConnection(tx, "gmail"))) throw new Error("Gmail isn't connected (Connectors › Gmail).");
  if (step.type === "email_client" || step.type === "whatsapp_client" || step.type === "gmail_send") {
    const email = step.type !== "whatsapp_client";
    const contacts = (await clientContacts(tx, ctx, String(c.to))).filter((k) => (email ? k.email : k.phone));
    if (!contacts.length) throw new Error(`No ${String(c.to)} contact at ${ctx.company_name || "the client"} with ${email ? "an email address" : "a WhatsApp number"}.`);
    for (const k of contacts) {
      const v = { ...vars, contact: firstName(k.name), hub_link: appUrl(`/hub/${await ensureHubToken(tx, k.id)}${hubPath(ctx)}`) };
      await queueMessage(tx, {
        channel: email ? "email" : "whatsapp",
        toName: k.name,
        to: email ? k.email : k.phone,
        subject: email ? render(c.subject, v) : undefined,
        body: render(c.body, v),
        relatedType: "automation",
        relatedId: a.id,
        via: step.type === "gmail_send" ? "gmail" : undefined,
      });
    }
    return `${email ? "Emailed" : "WhatsApp'd"} ${contacts.map((k) => firstName(k.name)).join(", ")}`;
  }
  if (step.type === "slack_message") {
    const slack = await activeConnection(tx, "slack");
    if (!slack) throw new Error("Slack isn't connected (Connectors › Slack).");
    const mapped = c.channel === "client" && ctx.company_id
      ? await tx.one<{ external_id: string; external_label: string }>("select external_id, external_label from connection_mappings where connection_id = $1 and company_id = $2 limit 1", [slack.id, ctx.company_id])
      : null;
    const channel = mapped ?? (slack.settings.default_channel ? { external_id: String(slack.settings.default_channel), external_label: String(slack.settings.default_channel_label ?? "") } : null);
    if (!channel) throw new Error(`No Slack channel for ${ctx.company_name || "this client"}, and no default channel set.`);
    const text = `${render(c.message, vars)}\n<${appUrl(ctx.href)}|Open in 8gency>`;
    await queueMessage(tx, { channel: "slack", toName: channel.external_label, to: channel.external_id, body: text, relatedType: "automation", relatedId: a.id });
    return `Posted to ${channel.external_label || "Slack"}`;
  }
  if (step.type === "calendar_event") {
    const userId = c.who === "job_owner" ? ctx.owner_id : ctx.account_manager_id;
    const person = userId ? await tx.one<{ id: string; name: string; email: string }>("select id, name, email from users where id = $1 and active", [userId]) : null;
    if (!person) throw new Error(`There's no ${c.who === "job_owner" ? "job owner" : "account manager"} to book this for.`);
    if (!(await activeConnection(tx, "google_calendar", person.id))) throw new Error(`${person.name} hasn't connected Google Calendar (Connectors › Google Calendar).`);
    const settings = await agencySettings(tx);
    const time = /^\d{1,2}:\d{2}$/.test(String(c.time)) ? String(c.time) : "10:00";
    const start = zonedIso(addDays(todayIn(settings.timezone), Number(c.in_days) || 0), time, settings.timezone);
    const invitees = c.invite && c.invite !== "none" ? (await clientContacts(tx, ctx, String(c.invite))).map((k) => k.email).filter(Boolean) : [];
    const title = render(c.title, vars).slice(0, 200) || a.name;
    await queueMessage(tx, {
      channel: "calendar",
      toName: person.name,
      to: person.email,
      subject: title,
      body: render(c.notes, vars),
      relatedType: "automation",
      relatedId: a.id,
      payload: { user_id: person.id, start, minutes: Number(c.minutes) || 30, attendees: invitees },
    });
    return `Booked “${title}” on ${firstName(person.name)}'s calendar`;
  }
  if (step.type === "create_task") {
    if (!ctx.job_id) throw new Error("This trigger isn't tied to a job, so there's nowhere to add the task.");
    const job = await tx.one<{ status: string }>("select status from jobs where id = $1", [ctx.job_id]);
    if (job?.status === "closed") return "Job is closed: no task created";
    const assignee = c.assignee === "job_owner" ? ctx.owner_id : c.assignee === "account_manager" ? ctx.account_manager_id : null;
    const settings = await agencySettings(tx);
    const title = render(c.title, vars).slice(0, 200) || a.name;
    await tx.q("insert into tasks (agency_id, job_id, title, assignee_id, due_date, notes) values ($1,$2,$3,$4,$5,$6)", [
      tx.agencyId,
      ctx.job_id,
      title,
      assignee,
      addDays(todayIn(settings.timezone), Number(c.due_in_days) || 0),
      `Created by the automation “${a.name}”.`,
    ]);
    return `Created task “${title}”`;
  }
  throw new Error(`Unknown action "${step.type}".`);
}

/** A wall-clock time in a time zone, as an ISO instant. */
export function zonedIso(date: string, time: string, tz: string) {
  const [h, m] = time.split(":").map(Number);
  const guess = new Date(`${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
  const offset = new Date(guess.toLocaleString("en-US", { timeZone: tz })).getTime() - new Date(guess.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  return new Date(guess.getTime() - offset).toISOString();
}

/** Run one automation for one record. A failing action rolls back only this run (savepoint) and is logged. */
async function runOne(tx: Tx, a: AutomationRow, ctx: Ctx, recordKey: string) {
  const settings = await agencySettings(tx);
  const vars: Record<string, string> = {
    client: ctx.company_name,
    job: ctx.job_label,
    item: ctx.item,
    amount: ctx.amount_cents !== null ? formatMoney(ctx.amount_cents, ctx.currency) : "",
    days: ctx.days !== undefined ? String(ctx.days) : "",
    percent: ctx.percent !== undefined ? String(ctx.percent) : "",
    trigger: triggerDef(a.trigger.type)?.label ?? "",
    agency: settings.name,
    contact: "",
    hub_link: "",
  };
  let status: "ok" | "error" = "ok";
  let summary: string;
  await tx.q("savepoint automation_run");
  try {
    const done: string[] = [];
    for (const [n, step] of a.actions.entries()) done.push(await execute(tx, a, step, ctx, vars, n, recordKey));
    await tx.q("release savepoint automation_run");
    summary = done.join(" · ");
  } catch (e) {
    await tx.q("rollback to savepoint automation_run");
    status = "error";
    summary = (e as Error).message;
  }
  await tx.q(
    `insert into automation_runs (agency_id, automation_id, record_key, status, summary) values ($1,$2,$3,$4,$5)
     on conflict (automation_id, record_key) do nothing`,
    [tx.agencyId, a.id, recordKey, status, `${ctx.item}: ${summary}`.slice(0, 500)],
  );
  await tx.q("update automations set last_run_at = now(), run_count = run_count + 1 where id = $1", [a.id]);
  return status;
}

/**
 * Something happened (a job moved, a client approved, an invoice was paid):
 * run every enabled custom automation listening for it. Never breaks the
 * action that fired it: any failure is contained and logged.
 */
export async function fireEvent(tx: Tx, type: string, recordId: string) {
  await tx.q("savepoint automation_event");
  try {
    const autos = await tx.q<AutomationRow>(
      "select id, name, trigger, filters, actions from automations where enabled and builtin is null and trigger->>'type' = $1 order by created_at",
      [type],
    );
    if (autos.length) {
      const ctx = await loadContext(tx, recordTypeOf(type), recordId);
      if (ctx) {
        const stamp = Date.now();
        for (const a of autos) if (triggerMatches(a.trigger, ctx) && passes(a.filters, ctx)) await runOne(tx, a, ctx, `${type}:${recordId}:${stamp}`);
      }
    }
    await tx.q("release savepoint automation_event");
  } catch (e) {
    await tx.q("rollback to savepoint automation_event");
    console.error(`automation event ${type} failed`, e);
  }
}

/** Records that match a scheduled trigger right now, with how far past the threshold they are. */
async function scheduledMatches(tx: Tx, t: Step, today: string): Promise<{ id: string; days?: number; percent?: number }[]> {
  const n = Number(t.config.days ?? t.config.percent ?? 0);
  if (t.type === "schedule.invoice_overdue")
    return (await tx.q<{ id: string; due_date: string }>("select id, due_date::text from invoices where status = 'sent' and due_date <= $1", [addDays(today, -n)])).map((r) => ({
      id: r.id,
      days: daysBetween(r.due_date, today),
    }));
  if (t.type === "schedule.deliverable_waiting")
    return (await tx.q<{ id: string; sent: string }>("select id, (sent_to_client_at::date)::text as sent from deliverables where status = 'client_review' and sent_to_client_at::date <= $1", [addDays(today, -n)])).map((r) => ({
      id: r.id,
      days: daysBetween(r.sent, today),
    }));
  if (t.type === "schedule.task_overdue")
    return (
      await tx.q<{ id: string; due_date: string }>(
        "select t.id, t.due_date::text from tasks t join jobs j on j.id = t.job_id where t.status <> 'done' and j.status <> 'closed' and t.due_date <= $1",
        [addDays(today, -n)],
      )
    ).map((r) => ({ id: r.id, days: daysBetween(r.due_date, today) }));
  if (t.type === "schedule.budget_burn")
    return (
      await tx.q<{ id: string; burn: number }>(
        `select j.id, round(100 * coalesce((select sum(hours) from time_entries te where te.job_id = j.id), 0) / j.budget_hours) as burn
           from jobs j where j.status in ('in_progress', 'waiting_client') and j.budget_hours > 0`,
      )
    )
      .filter((r) => Number(r.burn) >= n)
      .map((r) => ({ id: r.id, percent: Number(r.burn) }));
  return [];
}

/** Scheduled triggers (overdue, waiting, budget): each automation runs once per matching record. */
export async function runScheduledAutomations(tx: Tx) {
  const settings = await agencySettings(tx);
  const today = todayIn(settings.timezone);
  const autos = await tx.q<AutomationRow>("select id, name, trigger, filters, actions from automations where enabled and builtin is null and trigger->>'type' like 'schedule.%'");
  let ran = 0;
  for (const a of autos) {
    for (const m of await scheduledMatches(tx, a.trigger, today)) {
      const key = `${a.trigger.type}:${m.id}`;
      if (await tx.one("select 1 from automation_runs where automation_id = $1 and record_key = $2", [a.id, key])) continue;
      const ctx = await loadContext(tx, recordTypeOf(a.trigger.type), m.id);
      if (!ctx || !passes(a.filters, ctx)) continue;
      await runOne(tx, a, { ...ctx, days: m.days, percent: m.percent }, key);
      ran++;
    }
  }
  return ran;
}

/** Make sure every built-in rule has a row (so it can be switched off) and return the ones that are on. */
export async function enabledBuiltins(tx: Tx): Promise<Set<string>> {
  for (const b of BUILTINS) {
    await tx.q(
      `insert into automations (agency_id, name, description, builtin) values ($1,$2,$3,$4) on conflict (agency_id, builtin) do nothing`,
      [tx.agencyId, b.name, b.description, b.key],
    );
  }
  const on = await tx.q<{ builtin: string }>("select builtin from automations where builtin is not null and enabled");
  return new Set(on.map((r) => r.builtin));
}
