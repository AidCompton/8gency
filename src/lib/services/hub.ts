import { adminQuery, withTenant, type Tx } from "../db";
import { listRetainers } from "./retainers";

export interface HubContact {
  id: string;
  agency_id: string;
  company_id: string;
  name: string;
  email: string;
  role: "approver" | "commenter" | "billing" | "legal";
  company_name: string;
  agency_name: string;
  agency_color: string;
}

/**
 * Resolve a login-free client hub link (M06, principle 3). Tokens are random,
 * expire, and are revoked the day a contact leaves (Rule 14).
 */
export async function resolveHubToken(token: string): Promise<HubContact | null> {
  if (!token || token.length < 20) return null;
  const rows = await adminQuery<HubContact>(
    `select c.id, c.agency_id, c.company_id, c.name, c.email, c.role, co.name as company_name, a.name as agency_name, a.brand_color as agency_color
       from contacts c join companies co on co.id = c.company_id join agencies a on a.id = c.agency_id
      where c.hub_token = $1 and c.active and (c.hub_token_expires_at is null or c.hub_token_expires_at > now())`,
    [token],
  );
  return rows[0] ?? null;
}

export function asContact<T>(contact: HubContact, fn: (tx: Tx) => Promise<T>) {
  return withTenant({ agencyId: contact.agency_id, userId: null, actorLabel: `${contact.name} (client)` }, fn);
}

/** Everything the client sees: waiting on them (with the clock), in progress, delivered, retainer use, invoices. */
export async function hubOverview(tx: Tx, contact: HubContact) {
  const waiting = await tx.q<{ id: string; name: string; job_name: string; sent_to_client_at: Date; version: number; rounds_used: number }>(
    `select d.id, d.name, j.name as job_name, d.sent_to_client_at, d.rounds_used,
            (select max(number) from versions v where v.deliverable_id = d.id) as version
       from deliverables d join jobs j on j.id = d.job_id
      where j.company_id = $1 and d.status = 'client_review' order by d.sent_to_client_at`,
    [contact.company_id],
  );
  const changes = await tx.q<{ id: string; title: string; price_cents: number; estimate_hours: number; sent_at: Date }>(
    "select id, title, price_cents, estimate_hours, sent_at from change_requests where company_id = $1 and status = 'sent' order by sent_at",
    [contact.company_id],
  );
  const jobs = await tx.q<{ id: string; number: string; name: string; status: string; due_date: string | null; open: number; done: number }>(
    `select j.id, j.number, j.name, j.status, j.due_date,
            (select count(*)::int from tasks t where t.job_id = j.id and t.status <> 'done') as open,
            (select count(*)::int from tasks t where t.job_id = j.id and t.status = 'done') as done
       from jobs j where j.company_id = $1 and j.status in ('briefing','in_progress','waiting_client') order by j.due_date nulls last`,
    [contact.company_id],
  );
  const delivered = await tx.q<{ id: string; name: string; job_name: string; approved_at: Date; approver: string | null }>(
    `select d.id, d.name, j.name as job_name, d.approved_at,
            (select approver_name from approvals a where a.subject_type = 'deliverable' and a.subject_id = d.id and a.decision = 'approved' order by created_at desc limit 1) as approver
       from deliverables d join jobs j on j.id = d.job_id
      where j.company_id = $1 and d.status = 'approved' order by d.approved_at desc limit 20`,
    [contact.company_id],
  );
  const invoices = ["billing", "approver"].includes(contact.role)
    ? await tx.q<{ id: string; number: string; status: string; issue_date: string; due_date: string; total_cents: number; paid_cents: number; currency: string }>(
        "select id, number, status, issue_date, due_date, total_cents, paid_cents, currency from invoices where company_id = $1 and status in ('sent','paid') order by issue_date desc limit 24",
        [contact.company_id],
      )
    : [];
  const retainers = (await listRetainers(tx, contact.company_id)).map((r) => ({
    name: r.retainer.name,
    used: r.usedHours,
    allocated: r.allocated,
    starts_on: r.period?.starts_on ?? null,
    ends_on: r.period?.ends_on ?? null,
  }));
  const requests = await tx.q<{ id: string; body: string; status: string; created_at: Date }>(
    "select id, body, status, created_at from client_requests where company_id = $1 and contact_id = $2 order by created_at desc limit 10",
    [contact.company_id, contact.id],
  );
  return { waiting, changes, jobs, delivered, invoices, retainers, requests };
}
