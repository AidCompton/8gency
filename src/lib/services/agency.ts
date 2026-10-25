import type { PoolClient } from "pg";
import type { Tx } from "../db";
import { suggestClientCode } from "../domain/jobNumber";
import type { Role } from "../permissions";
import { DEFAULT_RATE_CARD, ONBOARDING_CHECKLIST, type AgencyType } from "../templates";
import { UserError } from "./core";

/**
 * Create a new agency with an owner, a default South African entity and the
 * template rate card. Runs on the admin connection because no tenant exists yet.
 */
export async function createAgencyWithOwner(
  client: PoolClient,
  input: { agencyName: string; agencyType: AgencyType; ownerName: string; email: string; passwordHash: string },
) {
  const exists = await client.query("select 1 from users where lower(email) = lower($1)", [input.email]);
  if (exists.rowCount) throw new UserError("An account with that email already exists. Log in instead.");

  const agency = (
    await client.query<{ id: string }>("insert into agencies (name, agency_type) values ($1,$2) returning id", [
      input.agencyName,
      input.agencyType,
    ])
  ).rows[0];
  // South African VAT preset. Confirm the current rate and tax-invoice
  // requirements with an accountant before relying on it.
  await client.query(
    `insert into entities (agency_id, name, legal_name, currency, tax_label, tax_rate, invoice_prefix, is_default)
     values ($1,$2,$2,'ZAR','VAT',0.15,'INV-',true)`,
    [agency.id, input.agencyName],
  );
  const owner = (
    await client.query<{ id: string }>(
      `insert into users (agency_id, email, name, password_hash, role, title, cost_rate_cents, target_utilisation)
       values ($1,$2,$3,$4,'owner','Creative Director',$5,0.3) returning id`,
      [agency.id, input.email.toLowerCase(), input.ownerName, input.passwordHash, 720_00],
    )
  ).rows[0];
  for (const r of DEFAULT_RATE_CARD) {
    await client.query("insert into rate_cards (agency_id, role_title, rate_cents, effective_from) values ($1,$2,$3,'2020-01-01')", [
      agency.id,
      r.role,
      r.rate,
    ]);
  }
  await client.query(
    `insert into audit_events (agency_id, actor_user_id, actor_label, action, record_type, record_id, after)
     values ($1,$2,$3,'agency.created','agency',$4,$5)`,
    [agency.id, owner.id, input.ownerName, agency.id, JSON.stringify({ name: input.agencyName, type: input.agencyType })],
  );
  return { agencyId: agency.id, userId: owner.id };
}

export async function createCompany(
  tx: Tx,
  input: {
    name: string;
    code?: string;
    po_required?: boolean;
    payment_terms_days?: number;
    billing_email?: string;
    currency?: string;
    account_manager_id?: string | null;
  },
) {
  const name = input.name.trim();
  if (!name) throw new UserError("Client name is required.");
  let code = (input.code?.trim() || suggestClientCode(name)).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  for (let i = 2; await tx.one("select 1 from companies where code = $1", [code]); i++) {
    code = `${code.replace(/\d+$/, "")}${i}`;
  }
  const entity = await tx.one<{ id: string }>("select id from entities where is_default order by created_at limit 1");
  const row = (await tx.one<{ id: string }>(
    `insert into companies (agency_id, name, code, po_required, payment_terms_days, billing_email, currency, entity_id, account_manager_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [
      tx.agencyId,
      name,
      code,
      input.po_required ?? false,
      input.payment_terms_days ?? 30,
      input.billing_email ?? "",
      input.currency ?? "ZAR",
      entity?.id ?? null,
      input.account_manager_id ?? null,
    ],
  ))!;
  let sort = 0;
  for (const item of ONBOARDING_CHECKLIST) {
    await tx.q(
      "insert into onboarding_items (agency_id, company_id, label, category, client_facing, sort) values ($1,$2,$3,$4,$5,$6)",
      [tx.agencyId, row.id, item.label, item.category, item.clientFacing, sort++],
    );
  }
  await tx.audit("company.created", "company", row.id, undefined, { name, code });
  return row.id;
}

export async function addContact(
  tx: Tx,
  input: { company_id: string; name: string; email?: string; phone?: string; role: "approver" | "commenter" | "billing" | "legal" },
) {
  if (!input.name.trim()) throw new UserError("Contact name is required.");
  const row = (await tx.one<{ id: string }>(
    "insert into contacts (agency_id, company_id, name, email, phone, role) values ($1,$2,$3,$4,$5,$6) returning id",
    [tx.agencyId, input.company_id, input.name.trim(), input.email?.trim() ?? "", input.phone?.trim() ?? "", input.role],
  ))!;
  if (input.role === "approver") {
    await tx.q(
      "update onboarding_items set done_at = coalesce(done_at, now()), done_by = coalesce(done_by, $2) where company_id = $1 and category = 'contacts'",
      [input.company_id, tx.actorLabel],
    );
  }
  await tx.audit("contact.created", "contact", row.id, undefined, input);
  return row.id;
}

export async function onboardingProgress(tx: Tx, companyId: string) {
  const items = await tx.q<{ id: string; label: string; category: string; client_facing: boolean; done_at: Date | null; done_by: string | null }>(
    "select id, label, category, client_facing, done_at, done_by from onboarding_items where company_id = $1 order by sort",
    [companyId],
  );
  const done = items.filter((i) => i.done_at).length;
  return { items, done, total: items.length, pct: items.length ? done / items.length : 1 };
}

export async function addTeamMember(
  tx: Tx,
  input: { name: string; email: string; passwordHash: string; role: Role; title: string; weekly_hours: number; cost_rate_cents: number; target_utilisation: number; team?: string | null },
) {
  const row = await tx.one<{ id: string }>(
    `insert into users (agency_id, email, name, password_hash, role, title, weekly_hours, cost_rate_cents, target_utilisation, team)
     values ($1,lower($2),$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [tx.agencyId, input.email, input.name, input.passwordHash, input.role, input.title, input.weekly_hours, input.cost_rate_cents, input.target_utilisation, input.team ?? null],
  );
  await tx.audit("user.created", "user", row!.id, undefined, { name: input.name, email: input.email, role: input.role });
  return row!.id;
}

/** Same-day access removal for leavers (Rule 14, PE-11). */
export async function deactivateUser(tx: Tx, userId: string) {
  const before = await tx.one("select name, role, active from users where id = $1", [userId]);
  await tx.q("update users set active = false where id = $1", [userId]);
  await tx.q("delete from sessions where user_id = $1", [userId]);
  await tx.q("delete from timers where user_id = $1", [userId]);
  await tx.audit("user.deactivated", "user", userId, before, { active: false });
}

/** Revoke a departing client contact's hub link immediately. */
export async function revokeContactAccess(tx: Tx, contactId: string) {
  await tx.q("update contacts set hub_token = null, hub_token_expires_at = null, active = false where id = $1", [contactId]);
  await tx.q("update action_tokens set used_at = coalesce(used_at, now()) where contact_id = $1", [contactId]);
  await tx.audit("contact.access_revoked", "contact", contactId);
}

const LOGO_MAX_BYTES = 512 * 1024;

/** Identify a logo by its bytes, not the browser's claimed type. */
export function sniffLogo(b: Buffer): string | null {
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(b.subarray(0, 2048).toString("utf8"))) return "image/svg+xml";
  return null;
}

/** Agency logo for the sidebar, client hub and invoices. `null` removes it. */
export async function setAgencyLogo(tx: Tx, bytes: Buffer | null) {
  if (bytes) {
    if (!bytes.length) throw new UserError("Choose an image file.");
    if (bytes.length > LOGO_MAX_BYTES) throw new UserError("Logos must be 512 KB or smaller. Export a smaller PNG or an SVG.");
    const mime = sniffLogo(bytes);
    if (!mime) throw new UserError("Use a PNG, JPEG, WebP or SVG image.");
    await tx.q("update agencies set logo = $2, logo_mime = $3, logo_updated_at = now() where id = $1", [tx.agencyId, bytes, mime]);
    await tx.audit("settings.logo", "agency", tx.agencyId, undefined, { mime, bytes: bytes.length });
  } else {
    await tx.q("update agencies set logo = null, logo_mime = '', logo_updated_at = now() where id = $1", [tx.agencyId]);
    await tx.audit("settings.logo", "agency", tx.agencyId, undefined, { removed: true });
  }
}
