"use server";
import { TEAMS } from "@/lib/domain/bookings";
import { act, num, opt, str } from "@/lib/actions";
import { requireUser, tenant } from "@/lib/auth";
import { toCents } from "@/lib/domain/money";
import { assertCan, can, ROLE_LABELS, type Role } from "@/lib/permissions";
import { inviteStaff, revokeInvite } from "@/lib/services/accountAuth";
import { deactivateUser, setAgencyLogo } from "@/lib/services/agency";
import { UserError } from "@/lib/services/core";
import { importClients, importTasks, importTime, parseCsv } from "@/lib/services/importer";

export async function updateAgencyAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "settings");
  await act("/app/settings?tab=agency", () =>
    tenant(user, async (tx) => {
      const before = await tx.one("select * from agencies where id = $1", [tx.agencyId]);
      const color = /^#[0-9a-f]{6}$/i.test(str(fd, "brand_color")) ? str(fd, "brand_color") : "#5b3df5";
      await tx.q(
        `update agencies set name=$2, brand_color=$3, job_number_format=$4, brief_threshold=$5, bill_within_days=$6, timezone=$7, ai_enabled=$8 where id=$1`,
        [tx.agencyId, str(fd, "name"), color, str(fd, "job_number_format") || "{CLIENT}-{YYYY}-{SEQ}", Math.min(100, Math.max(0, num(fd, "brief_threshold"))), num(fd, "bill_within_days"), str(fd, "timezone") || "Africa/Johannesburg", str(fd, "ai_enabled") === "on"],
      );
      await tx.audit("settings.agency", "agency", tx.agencyId, before, Object.fromEntries(fd));
    }),
  "Settings saved.");
}

export async function updateEntityAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "billing");
  await act("/app/settings?tab=entity", () =>
    tenant(user, async (tx) => {
      const id = str(fd, "entity_id");
      const before = await tx.one("select * from entities where id = $1", [id]);
      await tx.q(
        `update entities set name=$2, legal_name=$3, currency=$4, tax_label=$5, tax_rate=$6, tax_number=$7, registration_number=$8, address=$9, bank_details=$10, invoice_prefix=$11 where id=$1`,
        [id, str(fd, "name"), str(fd, "legal_name"), str(fd, "currency") || "ZAR", str(fd, "tax_label") || "VAT", num(fd, "tax_rate") / 100, str(fd, "tax_number"), str(fd, "registration_number"), str(fd, "address"), str(fd, "bank_details"), str(fd, "invoice_prefix")],
      );
      await tx.audit("settings.entity", "entity", id, before, Object.fromEntries(fd));
    }),
  "Billing entity saved.");
}

/** Rate changes take an effective date, so history keeps the rate it was costed at. */
export async function addRateAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "seeCostRates");
  await act("/app/settings?tab=rates", () =>
    tenant(user, async (tx) => {
      if (!str(fd, "role_title")) throw new UserError("Name the role.");
      await tx.q("insert into rate_cards (agency_id, role_title, company_id, rate_cents, effective_from) values ($1,$2,$3,$4,coalesce($5::date, current_date))", [
        tx.agencyId, str(fd, "role_title"), opt(fd, "company_id"), toCents(str(fd, "rate")), opt(fd, "effective_from"),
      ]);
      await tx.audit("rate_card.added", "rate_card", null, undefined, Object.fromEntries(fd));
    }),
  "Rate added.");
}

const teamOf = (fd: FormData) => (TEAMS.some((t) => t.key === str(fd, "team")) ? str(fd, "team") : null);

/** Invite by email: they set their own password from the link, so no password is ever shared. */
export async function addUserAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "manageTeam");
  await act("/app/settings?tab=team", async () => {
    const role = str(fd, "role") as Role;
    if (!(role in ROLE_LABELS)) throw new UserError("Choose a permission role.");
    await inviteStaff(user.agency_id, { id: user.id, name: user.name }, str(fd, "email"), {
      name: str(fd, "name"),
      role,
      title: str(fd, "title") || "Designer",
      team: TEAMS.some((t) => t.key === str(fd, "team")) ? str(fd, "team") : null,
      weekly_hours: num(fd, "weekly_hours") || 40,
      cost_rate_cents: toCents(str(fd, "cost_rate")),
      target_utilisation: (num(fd, "target_utilisation") || 70) / 100,
    });
  }, "Invitation sent. It works for 7 days.");
}

export async function revokeInviteAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "manageTeam");
  await act("/app/settings?tab=team", () => revokeInvite(user.agency_id, str(fd, "token_hash")), "Invitation cancelled.");
}

export async function updateUserAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "manageTeam");
  await act("/app/settings?tab=team", () =>
    tenant(user, async (tx) => {
      const id = str(fd, "user_id");
      const before = await tx.one("select role, title, team, weekly_hours, cost_rate_cents, target_utilisation from users where id = $1", [id]);
      const role = str(fd, "role") as Role;
      if (id === user.id && role !== "owner" && user.role === "owner") throw new UserError("You can't remove your own owner role.");
      await tx.q("update users set role=$2, title=$3, weekly_hours=$4, cost_rate_cents=$5, target_utilisation=$6, team=$7 where id=$1", [
        id, role, str(fd, "title"), num(fd, "weekly_hours"), toCents(str(fd, "cost_rate")), num(fd, "target_utilisation") / 100, teamOf(fd),
      ]);
      await tx.audit("user.updated", "user", id, before, { role, title: str(fd, "title"), team: teamOf(fd) });
    }),
  "Saved.");
}

export async function deactivateUserAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "manageTeam");
  await act("/app/settings?tab=team", () =>
    tenant(user, async (tx) => {
      if (str(fd, "user_id") === user.id) throw new UserError("You can't deactivate yourself.");
      await deactivateUser(tx, str(fd, "user_id"));
    }),
  "Access removed. Sessions ended and timers stopped.");
}

export async function importAction(fd: FormData) {
  const user = await requireUser();
  assertCan(user, "settings");
  await act("/app/settings?tab=import", () =>
    tenant(user, async (tx) => {
      const file = fd.get("file");
      if (!(file instanceof File) || !file.size) throw new UserError("Choose a CSV file.");
      const rows = parseCsv(await file.text());
      if (!rows.length) throw new UserError("That file has no rows.");
      const kind = str(fd, "kind");
      const s = kind === "clients" ? await importClients(tx, rows) : kind === "tasks" ? await importTasks(tx, rows) : await importTime(tx, rows);
      const created = Object.entries(s.created).map(([k, v]) => `${v} ${k.replace("_", " ")}`).join(", ") || "nothing new";
      const skipped = s.skipped.length ? ` Skipped ${s.skipped.length}: ${s.skipped.slice(0, 3).map((x) => `row ${x.row} (${x.reason})`).join("; ")}${s.skipped.length > 3 ? "…" : ""}` : "";
      return `/app/settings?tab=import&ok=${encodeURIComponent(`Imported ${s.rows} rows: ${created}.${skipped}`)}`;
    }),
  );
}

export async function markNotificationsReadAction(fd: FormData) {
  const user = await requireUser();
  await act("/app/notifications", () =>
    tenant(user, async (tx) => {
      const id = str(fd, "id");
      if (id) await tx.q("update notifications set read_at = now() where id = $1 and user_id = $2", [id, user.id]);
      else await tx.q("update notifications set read_at = now() where user_id = $1 and read_at is null", [user.id]);
    }),
  );
}

/** Only same-app paths, so a crafted form can't redirect elsewhere. */
const backTo = (fd: FormData) => (/^\/app(\/|\?|$)/.test(str(fd, "back")) ? str(fd, "back") : "/app/settings?tab=agency");

// Settings or billing users: the logo is set from Settings and from the invoice editor.
async function logoUser() {
  const user = await requireUser();
  if (!can(user, "billing")) assertCan(user, "settings");
  return user;
}

export async function uploadLogoAction(fd: FormData) {
  const user = await logoUser();
  const file = fd.get("logo");
  await act(
    backTo(fd),
    () =>
      tenant(user, async (tx) => {
        if (!(file instanceof File) || !file.size) throw new UserError("Choose an image file.");
        await setAgencyLogo(tx, Buffer.from(await file.arrayBuffer()));
      }),
    "Logo updated.",
  );
}

export async function removeLogoAction(fd: FormData) {
  const user = await logoUser();
  await act(backTo(fd), () => tenant(user, (tx) => setAgencyLogo(tx, null)), "Logo removed.");
}
