"use server";
import { act, bool, num, opt, str } from "@/lib/actions";
import { requireUser, tenant } from "@/lib/auth";
import { assertCan } from "@/lib/permissions";
import { addContact, createCompany, revokeContactAccess } from "@/lib/services/agency";
import { appUrl, ensureHubToken, queueMessage, UserError } from "@/lib/services/core";
import { firstName } from "@/lib/domain/text";

export async function createClientAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "manageJobs");
  await act("/app/clients/new", () =>
    tenant(user, async (tx) => {
      const id = await createCompany(tx, {
        name: str(fd, "name"),
        code: str(fd, "code"),
        po_required: bool(fd, "po_required"),
        payment_terms_days: num(fd, "payment_terms_days") || 30,
        billing_email: str(fd, "billing_email"),
        account_manager_id: opt(fd, "account_manager_id"),
      });
      return `/app/clients/${id}`;
    }),
  "Client created with the onboarding checklist. Add an approver next.");
}

export async function updateClientAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "manageJobs");
  const id = str(fd, "company_id");
  await act(`/app/clients/${id}?tab=settings`, () =>
    tenant(user, async (tx) => {
      const before = await tx.one("select * from companies where id = $1", [id]);
      await tx.q(
        "update companies set name=$2, po_required=$3, payment_terms_days=$4, billing_email=$5, account_manager_id=$6, status=$7, satisfaction=$8, currency=$9 where id=$1",
        [id, str(fd, "name"), bool(fd, "po_required"), num(fd, "payment_terms_days") || 30, str(fd, "billing_email"), opt(fd, "account_manager_id"), str(fd, "status"), num(fd, "satisfaction") || null, str(fd, "currency") || "ZAR"],
      );
      await tx.audit("company.updated", "company", id, before, Object.fromEntries(fd));
    }),
  "Saved.");
}

export async function addContactAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "manageJobs");
  const id = str(fd, "company_id");
  await act(`/app/clients/${id}`, () =>
    tenant(user, async (tx) => void (await addContact(tx, { company_id: id, name: str(fd, "name"), email: str(fd, "email"), phone: str(fd, "phone"), role: str(fd, "role") as "approver" }))),
  );
}

export async function revokeContactAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "manageJobs");
  await act(`/app/clients/${str(fd, "company_id")}`, () => tenant(user, (tx) => revokeContactAccess(tx, str(fd, "contact_id"))), "Hub access revoked.");
}

/** One click kills every live link for this client: use it when a forwarded email or a leaver is a worry. */
export async function revokeAllHubLinksAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "manageJobs");
  const companyId = str(fd, "company_id");
  await act(`/app/clients/${companyId}`, () =>
    tenant(user, async (tx) => {
      const gone = await tx.q("update contacts set hub_token = null, hub_token_expires_at = null where company_id = $1 and hub_token is not null returning id", [companyId]);
      await tx.audit("hub.links_revoked", "company", companyId, undefined, { links: gone.length });
    }),
  "Every hub link for this client is switched off. Send a fresh link to anyone who still needs one.");
}

export async function sendHubLinkAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "manageJobs");
  const companyId = str(fd, "company_id");
  await act(`/app/clients/${companyId}`, () =>
    tenant(user, async (tx) => {
      const c = await tx.one<{ id: string; name: string; email: string; phone: string }>("select id, name, email, phone from contacts where id = $1 and active", [str(fd, "contact_id")]);
      if (!c) throw new UserError("Contact not found.");
      const link = appUrl(`/hub/${await ensureHubToken(tx, c.id)}`);
      await queueMessage(tx, { channel: "email", toName: c.name, to: c.email, subject: `Your ${user.agency_name} client hub`, body: `Hi ${firstName(c.name)},\n\nEverything we're working on for you, what needs your approval and your invoices are here. No login needed:\n${link}\n\n${user.name}` });
      await queueMessage(tx, { channel: "whatsapp", toName: c.name, to: c.phone, body: `${user.agency_name}: your client hub (no login needed) ${link}` });
    }),
  "Hub link sent.");
}

export async function toggleOnboardingAction(fd: FormData) {
  const user = await requireUser();
  const id = str(fd, "company_id");
  await act(`/app/clients/${id}?tab=onboarding`, () =>
    tenant(user, async (tx) => {
      await tx.q("update onboarding_items set done_at = case when done_at is null then now() else null end, done_by = $2 where id = $1", [str(fd, "item_id"), user.name]);
      const left = await tx.one<{ n: number }>("select count(*)::int as n from onboarding_items where company_id = $1 and done_at is null", [id]);
      if (left?.n === 0) await tx.q("update companies set status = 'active' where id = $1 and status = 'onboarding'", [id]);
    }),
  );
}

export async function addContractAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "manageJobs");
  const id = str(fd, "company_id");
  await act(`/app/clients/${id}?tab=contracts`, () =>
    tenant(user, async (tx) => {
      if (!str(fd, "title")) throw new UserError("Name the contract.");
      const row = await tx.one<{ id: string }>(
        `insert into contracts (agency_id, company_id, kind, title, ip_terms, starts_on, ends_on, notice_days, renewal_on, price_increase_on, signed_at, signed_by, supersedes_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, case when $11 then now() end, case when $11 then $12 end, $13) returning id`,
        [tx.agencyId, id, str(fd, "kind"), str(fd, "title"), str(fd, "ip_terms"), opt(fd, "starts_on"), opt(fd, "ends_on"), num(fd, "notice_days") || 30, opt(fd, "renewal_on"), opt(fd, "price_increase_on"), bool(fd, "signed"), str(fd, "signed_by"), opt(fd, "supersedes_id")],
      );
      await tx.audit("contract.created", "contract", row!.id, undefined, Object.fromEntries(fd));
    }),
  "Contract recorded.");
}

export async function sendStatusReportAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "sendChangeRequests");
  const id = str(fd, "company_id");
  await act(`/app/clients/${id}?tab=report`, () =>
    tenant(user, async (tx) => {
      const body = str(fd, "body");
      if (!body) throw new UserError("The report is empty.");
      const contacts = await tx.q<{ id: string; name: string; email: string }>("select id, name, email from contacts where company_id = $1 and active and role in ('approver','commenter')", [id]);
      for (const c of contacts) {
        const link = appUrl(`/hub/${await ensureHubToken(tx, c.id)}`);
        await queueMessage(tx, { channel: "email", toName: c.name, to: c.email, subject: `Weekly update from ${user.agency_name}`, body: `${body}\n\nSee everything live: ${link}`, relatedType: "status_report", relatedId: id });
      }
      await tx.audit("status_report.sent", "company", id, undefined, { to: contacts.length });
    }),
  "Status update sent.");
}
