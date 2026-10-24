import { randomBytes } from "node:crypto";
import type { Tx } from "../db";
import { makeReferenceCode } from "../domain/inbound";

export class UserError extends Error {}

export function appUrl(path = "") {
  return `${process.env.APP_URL ?? "http://localhost:3000"}${path}`;
}

export async function nextCounter(tx: Tx, key: string): Promise<number> {
  const row = await tx.one<{ value: number }>(
    `insert into counters (agency_id, key, value) values ($1, $2, 1)
     on conflict (agency_id, key) do update set value = counters.value + 1
     returning value`,
    [tx.agencyId, key],
  );
  return row!.value;
}

export async function agencySettings(tx: Tx) {
  return (await tx.one<{
    id: string;
    name: string;
    timezone: string;
    base_currency: string;
    brand_color: string;
    job_number_format: string;
    brief_threshold: number;
    bill_within_days: number;
    burn_alert_thresholds: number[];
    time_locked_until: string | null;
    agency_type: string;
    ai_enabled: boolean;
  }>("select * from agencies where id = $1", [tx.agencyId]))!;
}

/**
 * Sell rate in force for a person's role on a date, with client override.
 * Callers snapshot this onto the time entry, so later rate changes never
 * rewrite history (M01 acceptance).
 */
export async function rateFor(tx: Tx, roleTitle: string, companyId: string | null, onDate: string): Promise<number> {
  const row = await tx.one<{ rate_cents: number }>(
    `select rate_cents from rate_cards
      where role_title = $1 and effective_from <= $3 and (company_id = $2 or company_id is null)
      order by (company_id is not null) desc, effective_from desc
      limit 1`,
    [roleTitle, companyId, onDate],
  );
  return row?.rate_cents ?? 0;
}

/** Average sell rate across the rate card, used to price hours when no person is named. */
export async function blendedRate(tx: Tx, companyId: string | null, onDate: string): Promise<number> {
  const row = await tx.one<{ avg: number | null }>(
    `select round(avg(rate_cents)) as avg from (
       select distinct on (role_title) rate_cents from rate_cards
        where effective_from <= $2 and (company_id = $1 or company_id is null)
        order by role_title, (company_id is not null) desc, effective_from desc) r`,
    [companyId, onDate],
  );
  return row?.avg ?? 0;
}

export async function notify(
  tx: Tx,
  userIds: (string | null | undefined)[],
  n: { kind: string; title: string; body?: string; href?: string; dedupe?: string },
) {
  const unique = [...new Set(userIds.filter(Boolean))] as string[];
  for (const uid of unique) {
    await tx.q(
      `insert into notifications (agency_id, user_id, kind, title, body, href, dedupe_key)
       values ($1,$2,$3,$4,$5,$6,$7) on conflict (agency_id, user_id, dedupe_key) do nothing`,
      [tx.agencyId, uid, n.kind, n.title, n.body ?? "", n.href ?? "", n.dedupe ?? null],
    );
  }
}

export async function usersWithRoles(tx: Tx, roles: string[]): Promise<string[]> {
  return (await tx.q<{ id: string }>("select id from users where active and role = any($1)", [roles])).map((r) => r.id);
}

export async function recordActivity(tx: Tx, kind: string, ids: { jobId?: string | null; taskId?: string | null }) {
  if (!tx.userId) return;
  await tx.q("insert into activity_events (agency_id, user_id, job_id, task_id, kind) values ($1,$2,$3,$4,$5)", [
    tx.agencyId,
    tx.userId,
    ids.jobId ?? null,
    ids.taskId ?? null,
    kind,
  ]);
}

/**
 * Queue an outbound message (email, WhatsApp, Slack or a calendar event). The
 * outbox is the delivery boundary: the connector worker sends queued rows
 * through the agency's connected apps (src/lib/connectors/delivery.ts).
 * Until a channel is connected they wait, visible at /app/outbox.
 */
export async function queueMessage(
  tx: Tx,
  m: {
    channel: "email" | "whatsapp" | "slack" | "calendar";
    toName: string;
    to: string;
    subject?: string;
    body: string;
    relatedType?: string;
    relatedId?: string;
    /** Send through this connector (e.g. "gmail") rather than the agency's default. */
    via?: string;
    payload?: Record<string, unknown>;
  },
) {
  if (!m.to) return;
  await tx.q(
    `insert into outbox_messages (agency_id, channel, to_name, to_address, subject, body, related_type, related_id, via, payload)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [tx.agencyId, m.channel, m.toName, m.to, m.subject ?? "", m.body, m.relatedType ?? null, m.relatedId ?? null, m.via ?? null, JSON.stringify(m.payload ?? {})],
  );
}

export async function ensureHubToken(tx: Tx, contactId: string): Promise<string> {
  const c = await tx.one<{ hub_token: string | null; hub_token_expires_at: Date | null }>(
    "select hub_token, hub_token_expires_at from contacts where id = $1",
    [contactId],
  );
  if (c?.hub_token && (!c.hub_token_expires_at || c.hub_token_expires_at > new Date())) return c.hub_token;
  const token = randomBytes(24).toString("base64url");
  await tx.q("update contacts set hub_token = $2, hub_token_expires_at = now() + interval '180 days' where id = $1", [contactId, token]);
  return token;
}

export async function createActionCode(
  tx: Tx,
  contactId: string,
  subjectType: "deliverable" | "change_request",
  subjectId: string,
): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = makeReferenceCode((n) => randomBytes(n));
    const row = await tx.one(
      `insert into action_tokens (code, agency_id, contact_id, subject_type, subject_id, expires_at)
       values ($1,$2,$3,$4,$5, now() + interval '30 days') on conflict do nothing returning code`,
      [code, tx.agencyId, contactId, subjectType, subjectId],
    );
    if (row) return code;
  }
  throw new Error("Could not allocate a reference code");
}
