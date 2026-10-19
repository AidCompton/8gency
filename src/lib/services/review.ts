import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Tx } from "../db";
import { nextRoundNeedsChangeRequest } from "../domain/scope";
import { agencySettings, appUrl, createActionCode, ensureHubToken, notify, queueMessage, recordActivity, UserError } from "./core";
import { createChangeRequest } from "./scope";
import { firstName } from "../domain/text";

export const UPLOAD_ROOT = resolve(process.env.UPLOAD_DIR ?? "./uploads");
const MAX_UPLOAD = 50 * 1024 * 1024;

export type DeliverableStatus = "draft" | "internal_review" | "client_review" | "changes_requested" | "approved";

export interface DeliverableRow {
  id: string;
  job_id: string;
  scope_item_id: string | null;
  name: string;
  status: DeliverableStatus;
  rounds_used: number;
  extra_rounds: number;
  approver_contact_id: string | null;
  sent_to_client_at: Date | null;
  approved_at: Date | null;
  due_date: string | null;
  rounds_allowed: number | null;
  scope_name: string | null;
  job_number: string;
  job_name: string;
  company_id: string;
  company_name: string;
  owner_id: string | null;
  account_manager_id: string | null;
  retainer_id: string | null;
}

export async function getDeliverable(tx: Tx, id: string) {
  return tx.one<DeliverableRow>(
    `select d.*, s.rounds_allowed, s.name as scope_name, j.number as job_number, j.name as job_name, j.company_id, c.name as company_name,
            j.owner_id, j.account_manager_id, j.retainer_id
       from deliverables d join jobs j on j.id = d.job_id join companies c on c.id = j.company_id
       left join scope_items s on s.id = d.scope_item_id
      where d.id = $1`,
    [id],
  );
}

export function roundsAllowance(d: Pick<DeliverableRow, "rounds_allowed" | "extra_rounds">) {
  return (d.rounds_allowed ?? 2) + d.extra_rounds;
}

export async function createDeliverable(tx: Tx, input: { job_id: string; name: string; scope_item_id: string | null; approver_contact_id: string | null; due_date: string | null }) {
  if (!input.name.trim()) throw new UserError("Name the deliverable.");
  const row = await tx.one<{ id: string }>(
    `insert into deliverables (agency_id, job_id, name, scope_item_id, approver_contact_id, due_date) values ($1,$2,$3,$4,$5,$6) returning id`,
    [tx.agencyId, input.job_id, input.name.trim(), input.scope_item_id || null, input.approver_contact_id || null, input.due_date || null],
  );
  await tx.audit("deliverable.created", "deliverable", row!.id, undefined, input);
  return row!.id;
}

/** Version stacking (CR-02): every upload is a new numbered version; nothing is overwritten. */
export async function uploadVersion(tx: Tx, deliverableId: string, file: File, notes: string) {
  if (!file || file.size === 0) throw new UserError("Choose a file to upload.");
  if (file.size > MAX_UPLOAD) throw new UserError("Files are limited to 50 MB in this version.");
  const d = await getDeliverable(tx, deliverableId);
  if (!d) throw new UserError("Deliverable not found.");
  if (d.status === "approved") throw new UserError("This deliverable is approved. Create a new deliverable for further changes.");
  const next = (await tx.one<{ n: number }>("select coalesce(max(number),0) + 1 as n from versions where deliverable_id = $1", [deliverableId]))!.n;
  const safe = file.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-80);
  const rel = join(tx.agencyId, deliverableId, `v${next}-${randomUUID().slice(0, 8)}-${safe}`);
  const abs = join(UPLOAD_ROOT, rel);
  await mkdir(join(UPLOAD_ROOT, tx.agencyId, deliverableId), { recursive: true });
  await writeFile(abs, Buffer.from(await file.arrayBuffer()));
  const v = await tx.one<{ id: string }>(
    `insert into versions (agency_id, deliverable_id, number, file_name, file_path, mime, size_bytes, notes, uploaded_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [tx.agencyId, deliverableId, next, file.name, rel, file.type || "application/octet-stream", file.size, notes, tx.userId],
  );
  if (d.status === "changes_requested") await tx.q("update deliverables set status = 'draft' where id = $1", [deliverableId]);
  await recordActivity(tx, "version.uploaded", { jobId: d.job_id });
  return v!.id;
}

export async function latestVersion(tx: Tx, deliverableId: string) {
  return tx.one<{ id: string; number: number; file_name: string; mime: string }>(
    "select id, number, file_name, mime from versions where deliverable_id = $1 order by number desc limit 1",
    [deliverableId],
  );
}

export async function sendForInternalReview(tx: Tx, deliverableId: string) {
  const d = await getDeliverable(tx, deliverableId);
  if (!d) throw new UserError("Deliverable not found.");
  if (!(await latestVersion(tx, deliverableId))) throw new UserError("Upload a version first.");
  await tx.q("update deliverables set status = 'internal_review' where id = $1", [deliverableId]);
  const reviewers = await tx.q<{ id: string }>("select id from users where active and (role in ('owner') or title ilike '%creative director%')");
  await notify(tx, reviewers.map((r) => r.id), {
    kind: "review_requested",
    title: `Review requested: ${d.name}`,
    body: `${d.job_number} · ${d.company_name}`,
    href: `/app/deliverables/${deliverableId}`,
    dedupe: `internal-review:${deliverableId}:${Date.now()}`,
  });
}

/** Internal stage: creative director or other permitted reviewer (blueprint 4.5). */
export async function internalDecision(tx: Tx, deliverableId: string, decision: "approved" | "changes_requested", note: string) {
  const d = await getDeliverable(tx, deliverableId);
  const v = await latestVersion(tx, deliverableId);
  if (!d || !v) throw new UserError("Nothing to review yet.");
  await tx.q(
    `insert into approvals (agency_id, subject_type, subject_id, version_id, version_number, stage, decision, approver_user_id, approver_name, channel, note)
     values ($1,'deliverable',$2,$3,$4,'internal',$5,$6,$7,'app',$8)`,
    [tx.agencyId, deliverableId, v.id, v.number, decision, tx.userId, tx.actorLabel, note],
  );
  if (note.trim()) {
    await tx.q(
      "insert into feedback (agency_id, deliverable_id, version_id, author_user_id, author_name, channel, body) values ($1,$2,$3,$4,$5,'app',$6)",
      [tx.agencyId, deliverableId, v.id, tx.userId, tx.actorLabel, note],
    );
  }
  await tx.q("update deliverables set status = $2 where id = $1", [deliverableId, decision === "approved" ? "draft" : "changes_requested"]);
  await recordActivity(tx, "review.internal", { jobId: d.job_id });
  await tx.audit(`deliverable.internal_${decision}`, "deliverable", deliverableId, undefined, { version: v.number, note });
}

export interface SendToClientResult {
  sent: boolean;
  needsChangeRequest?: { roundsUsed: number; allowed: number };
}

/**
 * Send the latest version to the client approver. Rounds are counted against
 * scope (Rule 7). Once the allowance is used, the next round needs a change
 * request or an absorb decision from the account manager (M10 acceptance).
 */
export async function sendToClient(tx: Tx, deliverableId: string, opts: { absorbReason?: string; requestChange?: boolean } = {}): Promise<SendToClientResult> {
  const d = await getDeliverable(tx, deliverableId);
  if (!d) throw new UserError("Deliverable not found.");
  const v = await latestVersion(tx, deliverableId);
  if (!v) throw new UserError("Upload a version first.");
  if (d.status === "client_review") throw new UserError("Already with the client.");
  if (d.status === "approved") throw new UserError("Already approved.");
  // M05: approvers are defined before the first job goes to review.
  const approver = d.approver_contact_id
    ? await tx.one<{ id: string; name: string; email: string; phone: string; active: boolean }>("select id, name, email, phone, active from contacts where id = $1", [d.approver_contact_id])
    : await tx.one<{ id: string; name: string; email: string; phone: string; active: boolean }>(
        "select id, name, email, phone, active from contacts where company_id = $1 and role = 'approver' and active order by created_at limit 1",
        [d.company_id],
      );
  if (!approver?.active) throw new UserError("Name a client approver before sending for review (client page → contacts).");

  const allowed = roundsAllowance(d);
  if (nextRoundNeedsChangeRequest(d.rounds_used, allowed)) {
    if (opts.requestChange) {
      const open = await tx.one<{ id: string }>("select id from change_requests where deliverable_id = $1 and status in ('draft','sent')", [d.id]);
      if (open) throw new UserError("A change request for the extra round is already open. Get it approved (or absorb it), then send this version.");
      const crId = await createChangeRequest(tx, {
        company_id: d.company_id,
        job_id: d.job_id,
        retainer_id: d.retainer_id,
        deliverable_id: d.id,
        title: `Extra review round for ${d.name}`,
        description: `Round ${d.rounds_used + 1} of ${d.name}. The scope included ${allowed} round(s).`,
        origin: "rounds",
        estimate_hours: 2,
      });
      await notify(tx, [d.account_manager_id], {
        kind: "change_request",
        title: `Rounds used up on ${d.name}: change request drafted`,
        href: `/app/scope/${crId}`,
        dedupe: `rounds-cr:${crId}`,
      });
      return { sent: false };
    }
    if (!opts.absorbReason?.trim()) return { sent: false, needsChangeRequest: { roundsUsed: d.rounds_used, allowed } };
    const crId = await createChangeRequest(tx, {
      company_id: d.company_id,
      job_id: d.job_id,
      deliverable_id: d.id,
      title: `Extra review round for ${d.name}`,
      origin: "rounds",
      estimate_hours: 2,
    });
    await tx.q("update change_requests set status = 'absorbed', absorb_reason = $2, decided_at = now(), decided_by = $3, decided_channel = 'app' where id = $1", [
      crId,
      opts.absorbReason.trim(),
      tx.actorLabel,
    ]);
    await tx.q("update deliverables set extra_rounds = extra_rounds + 1 where id = $1", [d.id]);
    await tx.audit("change_request.absorbed", "change_request", crId, undefined, { reason: opts.absorbReason, origin: "rounds" });
  }

  await tx.q("update deliverables set status = 'client_review', rounds_used = rounds_used + 1, sent_to_client_at = now(), approver_contact_id = $2 where id = $1", [
    deliverableId,
    approver.id,
  ]);
  await tx.q("update jobs set status = 'waiting_client' where id = $1 and status = 'in_progress'", [d.job_id]);
  const agency = await agencySettings(tx);
  const token = await ensureHubToken(tx, approver.id);
  const code = await createActionCode(tx, approver.id, "deliverable", deliverableId);
  const link = appUrl(`/hub/${token}/review/${deliverableId}`);
  await queueMessage(tx, {
    channel: "email",
    toName: approver.name,
    to: approver.email,
    subject: `For your approval: ${d.name} (v${v.number})`,
    body: `Hi ${firstName(approver.name)},\n\n${d.name} for ${d.job_name} is ready for your review (version ${v.number}, round ${d.rounds_used + 1} of ${Math.max(allowed, d.rounds_used + 1)}).\n\nView and comment: ${link}\n\nOr reply to this email: APPROVE ${code}, or CHANGES ${code} followed by your feedback.\n\n${agency.name}`,
    relatedType: "deliverable",
    relatedId: deliverableId,
  });
  await queueMessage(tx, {
    channel: "whatsapp",
    toName: approver.name,
    to: approver.phone,
    body: `${agency.name}: “${d.name}” v${v.number} is ready for your approval. Open ${link} — or reply APPROVE ${code}, or CHANGES ${code} with your feedback (voice notes welcome).`,
    relatedType: "deliverable",
    relatedId: deliverableId,
  });
  await recordActivity(tx, "deliverable.sent", { jobId: d.job_id });
  await tx.audit("deliverable.sent_to_client", "deliverable", deliverableId, { status: d.status }, { status: "client_review", version: v.number, round: d.rounds_used + 1, to: approver.name });
  return { sent: true };
}

/**
 * Client decision from the hub, an email reply or WhatsApp. Only the latest
 * version can be approved. The approval row is immutable (Rule 6).
 */
export async function clientDecision(
  tx: Tx,
  deliverableId: string,
  d: { decision: "approved" | "changes_requested"; channel: "hub" | "email" | "whatsapp" | "app"; contactId: string | null; approverName: string; note: string; versionId?: string },
) {
  const del = await getDeliverable(tx, deliverableId);
  const v = await latestVersion(tx, deliverableId);
  if (!del || !v) throw new UserError("Nothing to approve.");
  if (d.versionId && d.versionId !== v.id) throw new UserError("A newer version exists. Please review the latest version.");
  if (del.status !== "client_review") throw new UserError(del.status === "approved" ? "This is already approved." : "This isn't waiting on your review right now.");
  if (d.contactId && d.decision === "approved") {
    const c = await tx.one<{ role: string }>("select role from contacts where id = $1", [d.contactId]);
    if (c?.role !== "approver") throw new UserError("Only named approvers can approve. You can still leave feedback.");
  }
  await tx.q(
    `insert into approvals (agency_id, subject_type, subject_id, version_id, version_number, stage, decision, approver_contact_id, approver_user_id, approver_name, channel, note)
     values ($1,'deliverable',$2,$3,$4,'client',$5,$6,$7,$8,$9,$10)`,
    [tx.agencyId, deliverableId, v.id, v.number, d.decision, d.contactId, d.contactId ? null : tx.userId, d.approverName, d.channel, d.note],
  );
  if (d.note.trim()) {
    await tx.q(
      "insert into feedback (agency_id, deliverable_id, version_id, author_contact_id, author_user_id, author_name, channel, body) values ($1,$2,$3,$4,$5,$6,$7,$8)",
      [tx.agencyId, deliverableId, v.id, d.contactId, d.contactId ? null : tx.userId, d.approverName, d.channel === "app" ? "app" : d.channel, d.note],
    );
  }
  await tx.q(
    "update deliverables set status = $2, approved_at = case when $2 = 'approved' then now() else approved_at end where id = $1",
    [deliverableId, d.decision === "approved" ? "approved" : "changes_requested"],
  );
  // Job leaves "waiting on client" when nothing else is with the client.
  await tx.q(
    `update jobs set status = 'in_progress' where id = $1 and status = 'waiting_client'
       and not exists (select 1 from deliverables where job_id = $1 and status = 'client_review')`,
    [del.job_id],
  );
  await tx.q("update action_tokens set used_at = now() where subject_type = 'deliverable' and subject_id = $1 and used_at is null", [deliverableId]);
  await tx.audit(`deliverable.client_${d.decision}`, "deliverable", deliverableId, { status: "client_review" }, { version: v.number, by: d.approverName, channel: d.channel });
  const assignees = await tx.q<{ id: string }>("select distinct assignee_id as id from tasks where job_id = $1 and assignee_id is not null", [del.job_id]);
  await notify(tx, [del.owner_id, del.account_manager_id, ...assignees.map((a) => a.id)], {
    kind: "client_decision",
    title: `${d.decision === "approved" ? "✓ Approved" : "Changes requested"}: ${del.name} v${v.number}`,
    body: `${d.approverName} via ${d.channel}${d.note ? `: “${d.note.slice(0, 100)}”` : ""}`,
    href: `/app/deliverables/${deliverableId}`,
    dedupe: `client-decision:${deliverableId}:${v.number}:${d.decision}`,
  });
}

export async function addFeedback(
  tx: Tx,
  input: { deliverableId: string; versionId: string; body: string; channel: "app" | "hub" | "email" | "whatsapp"; authorName: string; contactId?: string | null; pinX?: number | null; pinY?: number | null; timecode?: number | null },
) {
  if (!input.body.trim()) throw new UserError("Write a comment.");
  const d = await getDeliverable(tx, input.deliverableId);
  if (!d) throw new UserError("Deliverable not found.");
  await tx.q(
    `insert into feedback (agency_id, deliverable_id, version_id, author_user_id, author_contact_id, author_name, channel, body, pin_x, pin_y, timecode)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      tx.agencyId,
      input.deliverableId,
      input.versionId,
      input.contactId ? null : tx.userId,
      input.contactId ?? null,
      input.authorName,
      input.channel,
      input.body.trim(),
      input.pinX ?? null,
      input.pinY ?? null,
      input.timecode ?? null,
    ],
  );
  if (!input.contactId) await recordActivity(tx, "feedback.added", { jobId: d.job_id });
  else
    await notify(tx, [d.owner_id, d.account_manager_id], {
      kind: "client_feedback",
      title: `Feedback on ${d.name}`,
      body: `${input.authorName}: ${input.body.slice(0, 120)}`,
      href: `/app/deliverables/${d.id}`,
    });
}

export async function deliverableHistory(tx: Tx, deliverableId: string) {
  const versions = await tx.q<{ id: string; number: number; file_name: string; mime: string; size_bytes: number; notes: string; created_at: Date; uploaded_by_name: string | null }>(
    `select v.id, v.number, v.file_name, v.mime, v.size_bytes, v.notes, v.created_at, u.name as uploaded_by_name
       from versions v left join users u on u.id = v.uploaded_by where v.deliverable_id = $1 order by v.number desc`,
    [deliverableId],
  );
  const feedback = await tx.q<{ id: string; version_id: string; author_name: string; channel: string; body: string; pin_x: number | null; pin_y: number | null; timecode: number | null; created_at: Date; is_client: boolean }>(
    `select id, version_id, author_name, channel, body, pin_x, pin_y, timecode, created_at, author_contact_id is not null as is_client
       from feedback where deliverable_id = $1 order by created_at`,
    [deliverableId],
  );
  const approvals = await tx.q<{ id: string; version_number: number; stage: string; decision: string; approver_name: string; channel: string; note: string; created_at: Date }>(
    "select id, version_number, stage, decision, approver_name, channel, note, created_at from approvals where subject_type = 'deliverable' and subject_id = $1 order by created_at",
    [deliverableId],
  );
  return { versions, feedback, approvals };
}

/** Items waiting on the internal reviewer (creative director dashboard). */
export async function reviewsWaiting(tx: Tx) {
  return tx.q<{ id: string; name: string; job_number: string; company_name: string }>(
    `select d.id, d.name, j.number as job_number, c.name as company_name from deliverables d
       join jobs j on j.id = d.job_id join companies c on c.id = j.company_id where d.status = 'internal_review' order by d.created_at`,
  );
}

