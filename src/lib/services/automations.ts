import type { Tx } from "../db";
import { addDays, daysBetween, todayIn } from "../domain/dates";
import { runCollections } from "./billing";
import { agencySettings, appUrl, ensureHubToken, notify, queueMessage, usersWithRoles } from "./core";
import { checkRetainerAlerts } from "./retainers";

/**
 * The default automation library (M26), built from Part 3's operating rules.
 * Every rule is idempotent (notifications carry a dedupe key), so this can run
 * from a scheduler every few minutes and opportunistically on dashboard loads.
 */
export async function runAutomations(tx: Tx) {
  const settings = await agencySettings(tx);
  const today = todayIn(settings.timezone);

  // Budget burn passes 75%, then 90%, then 100%: alert the owner and account manager (M08).
  const burns = await tx.q<{ id: string; number: string; name: string; owner_id: string; account_manager_id: string; burn: number }>(
    `select j.id, j.number, j.name, j.owner_id, j.account_manager_id,
            coalesce((select sum(hours) from time_entries te where te.job_id = j.id),0) / nullif(j.budget_hours,0) as burn
       from jobs j where j.status in ('in_progress','waiting_client') and j.budget_hours > 0`,
  );
  for (const b of burns) {
    const crossed = settings.burn_alert_thresholds.filter((t) => (b.burn ?? 0) * 100 >= t);
    const top = crossed[crossed.length - 1];
    if (!top) continue;
    await notify(tx, [b.owner_id, b.account_manager_id], {
      kind: "budget_burn",
      title: `${b.number} has used ${Math.round(b.burn * 100)}% of its budget`,
      body: top >= 100 ? `${b.name} is over budget. Review scope or raise a change request.` : b.name,
      href: `/app/jobs/${b.id}`,
      dedupe: `burn:${b.id}:${top}`,
    });
  }

  // Overdue or blocked tasks: alert the assignee and job owner.
  const late = await tx.q<{ id: string; title: string; assignee_id: string | null; owner_id: string | null; job_id: string; status: string }>(
    `select t.id, t.title, t.assignee_id, j.owner_id, j.id as job_id, t.status from tasks t join jobs j on j.id = t.job_id
      where t.status <> 'done' and j.status <> 'closed'
        and (t.due_date < $1 or (t.status = 'blocked' and t.last_activity_at < now() - interval '24 hours'))`,
    [today],
  );
  for (const t of late) {
    await notify(tx, [t.assignee_id, t.owner_id], {
      kind: "task_late",
      title: t.status === "blocked" ? `Blocked for over a day: ${t.title}` : `Overdue: ${t.title}`,
      href: `/app/jobs/${t.job_id}`,
      dedupe: `late:${t.id}:${today}`,
    });
  }

  // Client approvals chased automatically, once a day after 2 days waiting (rule: daily cadence).
  const waiting = await tx.q<{ id: string; name: string; sent_to_client_at: Date; contact_id: string; contact_name: string; email: string; company_id: string }>(
    `select d.id, d.name, d.sent_to_client_at, c.id as contact_id, c.name as contact_name, c.email, j.company_id
       from deliverables d join jobs j on j.id = d.job_id join contacts c on c.id = d.approver_contact_id
      where d.status = 'client_review' and d.sent_to_client_at < now() - interval '2 days' and c.active`,
  );
  for (const w of waiting) {
    const days = daysBetween(w.sent_to_client_at.toISOString().slice(0, 10), today);
    const key = `chase:${w.id}:${today}`;
    const already = await tx.one("select 1 from outbox_messages where related_type = 'deliverable_chase' and subject = $1", [key]);
    if (already) continue;
    const link = appUrl(`/hub/${await ensureHubToken(tx, w.contact_id)}/review/${w.id}`);
    await queueMessage(tx, {
      channel: "email",
      toName: w.contact_name,
      to: w.email,
      subject: key,
      body: `Hi ${w.contact_name.split(" ")[0]}, a gentle reminder that “${w.name}” has been waiting for your review for ${days} days. You can approve or comment here: ${link}`,
      relatedType: "deliverable_chase",
      relatedId: w.id,
    });
  }

  // Ready-to-bill items waiting beyond the agency's limit: tell finance (FN-01).
  const stale = await tx.q<{ id: string; name: string; number: string }>(
    `select m.id, m.name, j.number from milestones m join jobs j on j.id = m.job_id
      where m.status = 'complete' and m.completed_at < now() - make_interval(days => $1)`,
    [settings.bill_within_days],
  );
  const finance = await usersWithRoles(tx, ["finance", "owner"]);
  for (const s of stale) {
    await notify(tx, finance, {
      kind: "ready_to_bill",
      title: `Not invoiced after ${settings.bill_within_days} days: ${s.number} ${s.name}`,
      href: "/app/billing",
      dedupe: `stale-milestone:${s.id}`,
    });
  }

  // 30/60/90-day check-ins for new clients (ON-06): first 90 days carry the highest churn risk.
  const fresh = await tx.q<{ id: string; name: string; created_at: Date; account_manager_id: string | null }>(
    "select id, name, created_at, account_manager_id from companies where kind = 'client' and created_at > now() - interval '100 days'",
  );
  for (const c of fresh) {
    const age = daysBetween(c.created_at.toISOString().slice(0, 10), today);
    for (const d of [30, 60, 90]) {
      if (age >= d && age < d + 10) {
        await notify(tx, [c.account_manager_id], { kind: "checkin", title: `${d}-day check-in due with ${c.name}`, href: `/app/clients/${c.id}`, dedupe: `checkin:${c.id}:${d}` });
      }
    }
  }

  // Contract renewals and notice dates: 90, 60 and 30 days ahead (M04 acceptance).
  const contracts = await tx.q<{ id: string; title: string; company_id: string; company_name: string; key_date: string; account_manager_id: string | null }>(
    `select k.id, k.title, k.company_id, c.name as company_name, coalesce(k.renewal_on, k.ends_on)::text as key_date, c.account_manager_id
       from contracts k join companies c on c.id = k.company_id
      where k.signed_at is not null and coalesce(k.renewal_on, k.ends_on) between $1 and $2
        and not exists (select 1 from contracts n where n.supersedes_id = k.id)`,
    [today, addDays(today, 90)],
  );
  const owners = await usersWithRoles(tx, ["owner"]);
  for (const k of contracts) {
    const left = daysBetween(today, k.key_date);
    const step = [30, 60, 90].find((d) => left <= d)!;
    await notify(tx, [k.account_manager_id, ...owners], {
      kind: "contract",
      title: `${k.company_name}: “${k.title}” renews or ends in ${left} days`,
      href: `/app/clients/${k.company_id}`,
      dedupe: `contract:${k.id}:${step}`,
    });
  }

  await checkRetainerAlerts(tx);
  await runCollections(tx);
}
