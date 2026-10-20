import type { Tx } from "../db";
import { todayIn } from "../domain/dates";
import { formatMoney } from "../domain/money";
import { changeRequestMessage, detectOutOfScope, scopeMeter } from "../domain/scope";
import { summarise } from "../domain/text";
import {
  agencySettings,
  appUrl,
  blendedRate,
  createActionCode,
  ensureHubToken,
  notify,
  queueMessage,
  UserError,
  usersWithRoles,
} from "./core";

export interface ChangeRequestRow {
  id: string;
  company_id: string;
  job_id: string | null;
  retainer_id: string | null;
  deliverable_id: string | null;
  title: string;
  description: string;
  origin: string;
  estimate_hours: number;
  price_cents: number;
  status: "draft" | "sent" | "approved" | "declined" | "absorbed";
  absorb_reason: string | null;
  sent_at: Date | null;
  decided_at: Date | null;
  decided_by: string | null;
  decided_channel: string | null;
  created_at: Date;
}

/**
 * Suggest hours for a change request from similar past work (M11 AI, PR-01):
 * the median hours actually logged on tasks whose titles share words with it.
 */
export async function suggestEstimate(tx: Tx, title: string, companyId: string | null) {
  const words = [...new Set(title.toLowerCase().match(/[a-z]{4,}/g) ?? [])].filter(
    (w) => !["also", "with", "that", "this", "from", "please", "could", "would", "need", "just"].includes(w),
  );
  const rate = await blendedRate(tx, companyId, todayIn());
  if (!words.length) return { hours: null as number | null, basis: [] as string[], rate };
  const rows = await tx.q<{ title: string; hours: number }>(
    `select t.title, sum(te.hours) as hours
       from tasks t join time_entries te on te.task_id = t.id
      where t.status = 'done' and t.title ~* $1
      group by t.id, t.title
      order by max(te.work_date) desc limit 20`,
    [`\\m(${words.map((w) => w.replace(/[^a-z]/g, "")).join("|")})`],
  );
  if (!rows.length) return { hours: null, basis: [], rate };
  const sorted = rows.map((r) => r.hours).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return { hours: Math.round(median * 4) / 4, basis: rows.slice(0, 5).map((r) => `${r.title} (${r.hours}h)`), rate, range: [sorted[0], sorted[sorted.length - 1]] };
}

export async function createChangeRequest(
  tx: Tx,
  input: {
    company_id: string;
    job_id?: string | null;
    retainer_id?: string | null;
    deliverable_id?: string | null;
    retainer_period_id?: string | null;
    title: string;
    description?: string;
    origin?: "request" | "time" | "rounds" | "retainer_overage" | "manual";
    estimate_hours?: number;
    price_cents?: number;
  },
) {
  if (!input.title.trim()) throw new UserError("Describe the change.");
  let price = input.price_cents;
  if (price === undefined || price === 0) {
    const rate = await blendedRate(tx, input.company_id, todayIn());
    price = Math.round((input.estimate_hours ?? 0) * rate);
  }
  const row = await tx.one<{ id: string }>(
    `insert into change_requests (agency_id, company_id, job_id, retainer_id, deliverable_id, retainer_period_id, title, description,
                                  origin, estimate_hours, price_cents, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
    [
      tx.agencyId,
      input.company_id,
      input.job_id ?? null,
      input.retainer_id ?? null,
      input.deliverable_id ?? null,
      input.retainer_period_id ?? null,
      input.title.trim(),
      input.description?.trim() ?? "",
      input.origin ?? "manual",
      input.estimate_hours ?? 0,
      price,
      tx.userId,
    ],
  );
  await tx.audit("change_request.created", "change_request", row!.id, undefined, { ...input, price_cents: price });
  return row!.id;
}

export async function getChangeRequest(tx: Tx, id: string) {
  return tx.one<ChangeRequestRow & { company_name: string; job_number: string | null; job_name: string | null }>(
    `select cr.*, c.name as company_name, j.number as job_number, j.name as job_name
       from change_requests cr join companies c on c.id = cr.company_id left join jobs j on j.id = cr.job_id
      where cr.id = $1`,
    [id],
  );
}

/** Send a change request to the client's approvers by hub link, email and WhatsApp (M11, M06). */
export async function sendChangeRequest(tx: Tx, id: string) {
  const cr = await getChangeRequest(tx, id);
  if (!cr) throw new UserError("Change request not found.");
  if (cr.status !== "draft") throw new UserError("This change request has already been sent.");
  if (cr.price_cents <= 0 && cr.estimate_hours <= 0) throw new UserError("Add an estimate before sending.");
  const approvers = await tx.q<{ id: string; name: string; email: string; phone: string }>(
    "select id, name, email, phone from contacts where company_id = $1 and role = 'approver' and active",
    [cr.company_id],
  );
  if (!approvers.length) throw new UserError("This client has no named approver. Add one on the client page first.");
  const agency = await agencySettings(tx);
  const sender = tx.actorLabel;
  for (const a of approvers) {
    const token = await ensureHubToken(tx, a.id);
    const code = await createActionCode(tx, a.id, "change_request", id);
    const link = appUrl(`/hub/${token}/change/${id}`);
    const body = changeRequestMessage({
      contactName: a.name,
      title: cr.title,
      description: cr.description,
      hours: cr.estimate_hours,
      price: formatMoney(cr.price_cents),
      agencyName: agency.name,
      senderName: sender,
    });
    await queueMessage(tx, {
      channel: "email",
      toName: a.name,
      to: a.email,
      subject: `Change request for approval: ${cr.title}`,
      body: `${body}\n\nReview and approve: ${link}\n\nOr reply to this email with APPROVE ${code} or DECLINE ${code}.`,
      relatedType: "change_request",
      relatedId: id,
    });
    await queueMessage(tx, {
      channel: "whatsapp",
      toName: a.name,
      to: a.phone,
      body: `${agency.name}: change request “${cr.title}” — ${cr.estimate_hours}h, ${formatMoney(cr.price_cents)} excl. VAT. Reply APPROVE ${code} or DECLINE ${code}, or open ${link}`,
      relatedType: "change_request",
      relatedId: id,
    });
  }
  await tx.q("update change_requests set status = 'sent', sent_at = now() where id = $1", [id]);
  await tx.audit("change_request.sent", "change_request", id, { status: "draft" }, { status: "sent", to: approvers.map((a) => a.name) });
}

/**
 * Record the client's decision. On approval the scope baseline grows and the
 * change becomes billable in the ready-to-bill queue (M11 acceptance).
 */
export async function decideChangeRequest(
  tx: Tx,
  id: string,
  d: { decision: "approved" | "declined"; channel: "app" | "hub" | "email" | "whatsapp"; contactId?: string | null; approverName: string; userId?: string | null; note?: string },
) {
  const cr = await getChangeRequest(tx, id);
  if (!cr) throw new UserError("Change request not found.");
  if (!["sent", "draft"].includes(cr.status)) throw new UserError(`This change request is already ${cr.status}.`);
  await tx.q(
    `insert into approvals (agency_id, subject_type, subject_id, stage, decision, approver_user_id, approver_contact_id, approver_name, channel, note)
     values ($1,'change_request',$2,'client',$3,$4,$5,$6,$7,$8)`,
    [tx.agencyId, id, d.decision, d.userId ?? null, d.contactId ?? null, d.approverName, d.channel, d.note ?? ""],
  );
  let scopeItemId: string | null = null;
  if (d.decision === "approved") {
    if (cr.deliverable_id) {
      await tx.q("update deliverables set extra_rounds = extra_rounds + 1 where id = $1", [cr.deliverable_id]);
    }
    if (cr.job_id || cr.retainer_id) {
      const item = await tx.one<{ id: string }>(
        `insert into scope_items (agency_id, company_id, job_id, retainer_id, name, unit, quantity, rounds_allowed, source, change_request_id, inclusions)
         values ($1,$2,$3,$4,$5,'hours',$6,1,'change_request',$7,$8) returning id`,
        [tx.agencyId, cr.company_id, cr.job_id, cr.job_id ? null : cr.retainer_id, `CR: ${cr.title}`, cr.estimate_hours, id, cr.description],
      );
      scopeItemId = item!.id;
      if (cr.job_id) await tx.q("update jobs set budget_hours = budget_hours + $2 where id = $1", [cr.job_id, cr.estimate_hours]);
      await tx.q("update tasks set scope_item_id = $2 where change_request_id = $1", [id, scopeItemId]);
    }
  }
  await tx.q(
    `update change_requests set status = $2, decided_at = now(), decided_by = $3, decided_channel = $4, scope_item_id = $5 where id = $1`,
    [id, d.decision, d.approverName, d.channel, scopeItemId],
  );
  await tx.audit(`change_request.${d.decision}`, "change_request", id, { status: cr.status }, { status: d.decision, by: d.approverName, channel: d.channel });

  const job = cr.job_id ? await tx.one<{ owner_id: string; account_manager_id: string }>("select owner_id, account_manager_id from jobs where id = $1", [cr.job_id]) : null;
  const finance = d.decision === "approved" ? await usersWithRoles(tx, ["finance"]) : [];
  await notify(tx, [job?.owner_id, job?.account_manager_id, ...finance], {
    kind: "change_request",
    title: `Change request ${d.decision}: ${cr.title}`,
    body: `${cr.company_name} · ${formatMoney(cr.price_cents)} · via ${d.channel}`,
    href: `/app/scope/${id}`,
    dedupe: `cr-decided:${id}`,
  });
}

/** Record out-of-scope work as an investment with a reason, so the owner sees what's given away. */
export async function absorbChangeRequest(tx: Tx, id: string, reason: string) {
  if (!reason.trim()) throw new UserError("Say why this is being absorbed.");
  const cr = await getChangeRequest(tx, id);
  if (!cr) throw new UserError("Change request not found.");
  if (["approved", "declined", "absorbed"].includes(cr.status)) throw new UserError(`This change request is already ${cr.status}.`);
  await tx.q("update change_requests set status = 'absorbed', absorb_reason = $2, decided_at = now(), decided_by = $3, decided_channel = 'app' where id = $1", [
    id,
    reason.trim(),
    tx.actorLabel,
  ]);
  if (cr.deliverable_id) await tx.q("update deliverables set extra_rounds = extra_rounds + 1 where id = $1", [cr.deliverable_id]);
  await tx.audit("change_request.absorbed", "change_request", id, { status: cr.status }, { status: "absorbed", reason, value_cents: cr.price_cents });
}

// ───────────────────────── Request intake & triage ─────────────────────────

/** M06: a new client request never lands directly on a staff member's list; it goes to triage. */
export async function submitClientRequest(
  tx: Tx,
  input: { company_id: string; contact_id?: string | null; job_id?: string | null; body: string; channel: "hub" | "email" | "whatsapp" | "app" },
) {
  if (!input.body.trim()) throw new UserError("Tell us what you need.");
  const oos = detectOutOfScope(input.body);
  const row = await tx.one<{ id: string }>(
    `insert into client_requests (agency_id, company_id, contact_id, job_id, body, channel, oos_score, oos_signals)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [tx.agencyId, input.company_id, input.contact_id ?? null, input.job_id ?? null, input.body.trim(), input.channel, oos.score, oos.signals],
  );
  const company = await tx.one<{ name: string; account_manager_id: string | null }>("select name, account_manager_id from companies where id = $1", [input.company_id]);
  const triagers = company?.account_manager_id ? [company.account_manager_id] : await usersWithRoles(tx, ["owner", "ops"]);
  await notify(tx, triagers, {
    kind: "client_request",
    title: `${oos.likely ? "⚑ Possibly out of scope — " : ""}New request from ${company?.name}`,
    body: input.body.slice(0, 140),
    href: "/app/scope",
    dedupe: `request:${row!.id}`,
  });
  return { id: row!.id, oos };
}

export async function triageAsTask(tx: Tx, requestId: string, input: { job_id: string; scope_item_id: string | null; assignee_id: string | null; due_date: string | null; title: string }) {
  const req = await tx.one<{ status: string; body: string }>("select status, body from client_requests where id = $1", [requestId]);
  if (!req || req.status !== "new") throw new UserError("This request has already been triaged.");
  if (!input.scope_item_id) throw new UserError("Pick the scope item this belongs to, or convert the request to a change request.");
  const task = await tx.one<{ id: string }>(
    `insert into tasks (agency_id, job_id, scope_item_id, title, notes, assignee_id, due_date)
     values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [tx.agencyId, input.job_id, input.scope_item_id, input.title || summarise(req.body), req.body, input.assignee_id || null, input.due_date || null],
  );
  await tx.q("update client_requests set status = 'accepted', task_id = $2, job_id = $3, triaged_by = $4, triaged_at = now() where id = $1", [
    requestId,
    task!.id,
    input.job_id,
    tx.actorLabel,
  ]);
  if (input.assignee_id) await notify(tx, [input.assignee_id], { kind: "task_assigned", title: `New task: ${input.title}`, href: "/app/my-day", dedupe: `assign:${task!.id}` });
  await tx.audit("request.accepted", "client_request", requestId, undefined, { task_id: task!.id });
  return task!.id;
}

export async function triageAsChangeRequest(tx: Tx, requestId: string, input: { job_id: string | null; title: string; estimate_hours: number; price_cents?: number }) {
  const req = await tx.one<{ status: string; body: string; company_id: string; job_id: string | null }>(
    "select status, body, company_id, job_id from client_requests where id = $1",
    [requestId],
  );
  if (!req || req.status !== "new") throw new UserError("This request has already been triaged.");
  const jobId = input.job_id || req.job_id;
  const retainer = jobId ? await tx.one<{ retainer_id: string | null }>("select retainer_id from jobs where id = $1", [jobId]) : null;
  const crId = await createChangeRequest(tx, {
    company_id: req.company_id,
    job_id: jobId,
    retainer_id: retainer?.retainer_id ?? null,
    title: input.title || summarise(req.body),
    description: req.body,
    origin: "request",
    estimate_hours: input.estimate_hours,
    price_cents: input.price_cents,
  });
  await tx.q("update client_requests set status = 'change_request', change_request_id = $2, triaged_by = $3, triaged_at = now() where id = $1", [
    requestId,
    crId,
    tx.actorLabel,
  ]);
  return crId;
}

export async function dismissRequest(tx: Tx, requestId: string) {
  await tx.q("update client_requests set status = 'dismissed', triaged_by = $2, triaged_at = now() where id = $1 and status = 'new'", [requestId, tx.actorLabel]);
  await tx.audit("request.dismissed", "client_request", requestId);
}

// ───────────────────────── Scope meters ─────────────────────────

export interface ScopeItemUsage {
  id: string;
  name: string;
  unit: "deliverable" | "hours";
  quantity: number;
  rounds_allowed: number;
  inclusions: string;
  exclusions: string;
  source: string;
  used: number;
  hours: number;
  meter: ReturnType<typeof scopeMeter>;
}

/** Live scope meter per item: used, remaining, over (M11). */
export async function scopeUsage(tx: Tx, where: { jobId?: string; retainerId?: string; from?: string; to?: string }): Promise<ScopeItemUsage[]> {
  const rows = await tx.q<Omit<ScopeItemUsage, "meter">>(
    `select s.id, s.name, s.unit, s.quantity, s.rounds_allowed, s.inclusions, s.exclusions, s.source,
            coalesce((select sum(te.hours) from time_entries te where te.scope_item_id = s.id
                       and ($3::date is null or te.work_date >= $3) and ($4::date is null or te.work_date <= $4)),0) as hours,
            case when s.unit = 'hours'
                 then coalesce((select sum(te.hours) from time_entries te where te.scope_item_id = s.id
                       and ($3::date is null or te.work_date >= $3) and ($4::date is null or te.work_date <= $4)),0)
                 else (select count(*) from deliverables d where d.scope_item_id = s.id
                       and ($3::date is null or d.created_at::date >= $3) and ($4::date is null or d.created_at::date <= $4))
            end as used
       from scope_items s
      where ($1::uuid is null or s.job_id = $1) and ($2::uuid is null or s.retainer_id = $2)
      order by s.source, s.created_at`,
    [where.jobId ?? null, where.retainerId ?? null, where.from ?? null, where.to ?? null],
  );
  return rows.map((r) => ({ ...r, used: Number(r.used), meter: scopeMeter({ quantity: r.quantity, used: Number(r.used) }) }));
}

export async function addScopeItem(
  tx: Tx,
  input: { company_id: string; job_id?: string | null; retainer_id?: string | null; name: string; unit: "deliverable" | "hours"; quantity: number; rounds_allowed: number; inclusions?: string; exclusions?: string },
) {
  if (input.job_id) {
    const job = await tx.one<{ scope_locked_at: Date | null }>("select scope_locked_at from jobs where id = $1", [input.job_id]);
    if (job?.scope_locked_at) throw new UserError("The scope baseline is approved and locked. Add to it with a change request.");
  }
  if (!input.name.trim()) throw new UserError("Name the scope item.");
  await tx.q(
    `insert into scope_items (agency_id, company_id, job_id, retainer_id, name, unit, quantity, rounds_allowed, inclusions, exclusions)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [tx.agencyId, input.company_id, input.job_id ?? null, input.retainer_id ?? null, input.name.trim(), input.unit, input.quantity, input.rounds_allowed, input.inclusions ?? "", input.exclusions ?? ""],
  );
}

export async function removeScopeItem(tx: Tx, id: string) {
  const item = await tx.one<{ job_id: string | null; locked: Date | null }>(
    "select s.job_id, j.scope_locked_at as locked from scope_items s left join jobs j on j.id = s.job_id where s.id = $1",
    [id],
  );
  if (item?.locked) throw new UserError("The scope baseline is locked.");
  await tx.q("delete from scope_items where id = $1", [id]);
}
