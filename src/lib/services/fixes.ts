import type { Tx } from "../db";
import { formatShort, todayIn } from "../domain/dates";
import { formatMoney } from "../domain/money";
import { firstName } from "../domain/text";
import { createInvoice, debtors, readyToBill } from "./billing";
import { agencySettings, appUrl, blendedRate, ensureHubToken, notify, queueMessage, UserError } from "./core";
import { wipRisks } from "./eightgent";
import { reconcilePeriod } from "./retainers";
import { createChangeRequest } from "./scope";

// One-click fixes for the leaks the health scan finds. Each fix does the real
// work (drafts the invoice, drafts the change request, queues the reminder) and
// stops short of anything that reaches a client without a person: invoices and
// change requests are left as drafts to review and send.

export type FixKind = "invoice" | "change_request" | "reminder" | "reconcile" | "budget";

export interface Fix {
  kind: FixKind;
  /** What the fix acts on: a client, a task, an invoice, a retainer period or a job. */
  id: string;
  title: string;
  detail: string;
  cents: number | null;
  label: string;
}

const MIN_DAYS_BETWEEN_REMINDERS = 3;

export async function fixList(tx: Tx): Promise<Fix[]> {
  const settings = await agencySettings(tx);
  const today = todayIn(settings.timezone);
  const fixes: Fix[] = [];

  // 1. Work that's done and waiting to be invoiced, per client (imported time needs a person to confirm it first).
  const byClient = new Map<string, { name: string; cents: number; n: number }>();
  for (const i of await readyToBill(tx)) {
    if (i.source_type === "time") continue;
    const c = byClient.get(i.company_id) ?? { name: i.company_name, cents: 0, n: 0 };
    c.cents += i.amount_cents;
    c.n++;
    byClient.set(i.company_id, c);
  }
  for (const [id, c] of byClient) fixes.push({ kind: "invoice", id, title: `Invoice ${c.name}`, detail: `${c.n} ${c.n === 1 ? "item is" : "items are"} done and not billed yet`, cents: c.cents, label: "Draft the invoice" });

  // 2. Out-of-scope tasks nobody has turned into a change request.
  const oos = await tx.q<{ id: string; title: string; job: string; hours: number; estimate: number }>(
    `select t.id, t.title, j.number || ' ' || j.name as job, t.estimate_hours::float as estimate,
            coalesce((select sum(te.hours) from time_entries te where te.task_id = t.id), 0)::float as hours
       from tasks t join jobs j on j.id = t.job_id
      where t.out_of_scope and t.change_request_id is null and j.status <> 'closed'
        and ((t.status <> 'done') or (t.completed_at > now() - interval '60 days'))
      order by t.created_at desc limit 20`,
  );
  const rateByTask = await blendedRate(tx, null, today);
  for (const t of oos) fixes.push({ kind: "change_request", id: t.id, title: `Out of scope: ${t.title}`, detail: `${t.job}. ${Math.max(t.hours, t.estimate)}h of work the client hasn't agreed to pay for`, cents: Math.round(Math.max(t.hours, t.estimate) * rateByTask), label: "Draft the change request" });

  // 3. Invoices past their due date that haven't been nudged lately.
  for (const o of (await debtors(tx)).open.filter((x) => x.daysOverdue > 0)) {
    const r = await tx.one<{ recent: boolean }>("select coalesce(last_reminder_at > now() - make_interval(days => $2), false) as recent from invoices where id = $1", [o.id, MIN_DAYS_BETWEEN_REMINDERS]);
    if (!r?.recent) fixes.push({ kind: "reminder", id: o.id, title: `${o.company_name} owes ${formatMoney(o.outstanding, o.currency)}`, detail: `Invoice ${o.number} is ${o.daysOverdue} days overdue`, cents: o.outstanding, label: "Send a reminder" });
  }

  // 4. Retainer months that ended over their hours and haven't been settled.
  const periods = await tx.q<{ id: string; retainer: string; client: string; starts_on: string; ends_on: string; allocated: number; used: number; rate: number }>(
    `select p.id, r.name as retainer, c.name as client, p.starts_on::text, p.ends_on::text, (p.allocated_hours + p.rollover_in_hours)::float as allocated,
            coalesce((select sum(te.hours) from time_entries te join jobs j on j.id = te.job_id where j.retainer_id = r.id and te.work_date between p.starts_on and p.ends_on), 0)::float as used,
            coalesce((select round(avg(te.rate_cents)) from time_entries te join jobs j on j.id = te.job_id where j.retainer_id = r.id and te.work_date between p.starts_on and p.ends_on), 0)::float as rate
       from retainer_periods p join retainers r on r.id = p.retainer_id join companies c on c.id = r.company_id
      where p.ends_on < $1 and p.status <> 'reconciled'`,
    [today],
  );
  for (const p of periods.filter((x) => x.used > x.allocated)) {
    const over = Math.round((p.used - p.allocated) * 100) / 100;
    fixes.push({ kind: "reconcile", id: p.id, title: `${p.client}: ${over}h over the retainer`, detail: `${p.retainer}, ${formatShort(p.starts_on)} to ${formatShort(p.ends_on)}`, cents: Math.round(over * p.rate), label: "Draft the change request" });
  }

  // 5. Jobs running past their hours budget.
  for (const r of (await wipRisks(tx)).filter((x) => x.reasons.some((m) => /budget/i.test(m)))) {
    fixes.push({ kind: "budget", id: r.job_id, title: `${r.number} ${r.name}`, detail: `${r.company_name}: ${r.reasons.find((m) => /budget/i.test(m))}`, cents: null, label: "Tell the job owner" });
  }
  return fixes.sort((a, b) => (b.cents ?? 0) - (a.cents ?? 0));
}

/** Where to go afterwards, or a message to show; throws a UserError when the fix no longer applies. */
export async function applyFix(tx: Tx, kind: FixKind, id: string): Promise<{ href?: string; message?: string }> {
  if (kind === "invoice") {
    const items = (await readyToBill(tx, id)).filter((i) => i.source_type !== "time");
    if (!items.length) throw new UserError("Nothing is waiting to be invoiced for that client any more.");
    const invoiceId = await createInvoice(tx, id, items.map((i) => i.key));
    return { href: `/app/billing/invoices/${invoiceId}`, message: "Draft invoice ready. Check it, then send it." };
  }

  if (kind === "change_request") {
    const t = await tx.one<{ title: string; job_id: string; company_id: string; estimate: number; hours: number; change_request_id: string | null }>(
      `select t.title, t.job_id, j.company_id, t.estimate_hours::float as estimate, t.change_request_id,
              coalesce((select sum(te.hours) from time_entries te where te.task_id = t.id), 0)::float as hours
         from tasks t join jobs j on j.id = t.job_id where t.id = $1`,
      [id],
    );
    if (!t) throw new UserError("That task no longer exists.");
    if (t.change_request_id) return { href: `/app/scope/${t.change_request_id}` };
    const hours = Math.max(t.hours, t.estimate);
    const crId = await createChangeRequest(tx, { company_id: t.company_id, job_id: t.job_id, title: t.title, description: `Work outside the agreed scope: ${t.title}.`, origin: "time", estimate_hours: hours });
    await tx.q("update tasks set change_request_id = $2 where id = $1", [id, crId]);
    return { href: `/app/scope/${crId}`, message: "Change request drafted. Review the price, then send it to the client." };
  }

  if (kind === "reminder") {
    const inv = (await debtors(tx)).open.find((o) => o.id === id);
    if (!inv || inv.daysOverdue <= 0) throw new UserError("That invoice isn't overdue any more.");
    const settings = await agencySettings(tx);
    const contacts = await tx.q<{ id: string; name: string; email: string }>("select id, name, email from contacts where company_id = $1 and role = 'billing' and active and email <> ''", [inv.company_id]);
    if (!contacts.length) throw new UserError(`${inv.company_name} has no billing contact with an email address. Add one on the client page.`);
    for (const c of contacts) {
      const link = appUrl(`/hub/${await ensureHubToken(tx, c.id)}/invoices/${inv.id}`);
      await queueMessage(tx, {
        channel: "email",
        toName: c.name,
        to: c.email,
        subject: `Reminder: invoice ${inv.number} is overdue`,
        body: `Hello ${firstName(c.name)},\n\nInvoice ${inv.number} for ${formatMoney(inv.outstanding, inv.currency)} was due on ${formatShort(inv.due_date)} and is now ${inv.daysOverdue} day(s) overdue. If it's already on its way, thank you and please ignore this.\n\nView and pay: ${link}\n\nThank you,\n${settings.name}`,
        relatedType: "invoice",
        relatedId: inv.id,
      });
    }
    await tx.q("update invoices set last_reminder_at = now() where id = $1", [id]);
    await tx.audit("invoice.reminder_sent", "invoice", id, undefined, { to: contacts.length });
    return { message: `Reminder queued for ${contacts.map((c) => firstName(c.name)).join(", ")}. It goes out from your own email.` };
  }

  if (kind === "reconcile") {
    await reconcilePeriod(tx, id, "change_request");
    const cr = await tx.one<{ id: string }>("select id from change_requests where retainer_period_id = $1 order by created_at desc limit 1", [id]);
    return { href: cr ? `/app/scope/${cr.id}` : undefined, message: "Change request drafted for the extra hours. Review the price, then send it." };
  }

  const job = await tx.one<{ owner_id: string | null; account_manager_id: string | null; number: string; name: string; hours: number; budget: number }>(
    `select owner_id, account_manager_id, number, name, budget_hours::float as budget, coalesce((select sum(hours) from time_entries te where te.job_id = j.id), 0)::float as hours from jobs j where id = $1`,
    [id],
  );
  if (!job) throw new UserError("That job no longer exists.");
  const who = job.owner_id ?? job.account_manager_id;
  if (!who) throw new UserError("This job has no owner to tell. Set one on the job first.");
  const day = todayIn((await agencySettings(tx)).timezone);
  await notify(tx, [who], { kind: "budget", title: `${job.number} ${job.name} is over its hours budget`, body: `${Math.round(job.hours)}h used of ${Math.round(job.budget)}h. Decide: raise a change request, or tighten the scope.`, href: `/app/jobs/${id}?tab=money`, dedupe: `budgetfix:${id}:${day}` });
  const name = (await tx.one<{ name: string }>("select name from users where id = $1", [who]))?.name ?? "the job owner";
  return { message: `${firstName(name)} has been told.` };
}

