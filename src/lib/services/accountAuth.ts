import { adminQuery, withAdminTx, withTenant } from "../db";
import { firstName } from "../domain/text";
import { burnPasswordCheck, hashPassword, hashToken, newToken, passwordProblem, verifyPassword } from "../passwords";
import { recordAttempt, throttle } from "../security";
import { sendSystemMail } from "../systemMail";
import { AGENCY_TYPES, type AgencyType } from "../templates";
import { addTeamMember, createAgencyWithOwner } from "./agency";
import { appUrl, UserError } from "./core";
import type { Role } from "../permissions";

// Everything about getting into an account: reset, change, invites and the
// waitlist. Tokens are random, stored only as a hash, single use and expiring.

const HOUR = 3_600_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normEmail = (e: string) => e.trim().toLowerCase();

async function issue(kind: "reset" | "staff_invite" | "agency_invite", email: string, hours: number, o: { agencyId?: string; userId?: string; payload?: object; createdBy?: string } = {}) {
  const token = newToken();
  await adminQuery("insert into auth_tokens (token_hash, kind, email, agency_id, user_id, payload, created_by, expires_at) values ($1,$2,$3,$4,$5,$6,$7,$8)", [
    hashToken(token), kind, email, o.agencyId ?? null, o.userId ?? null, JSON.stringify(o.payload ?? {}), o.createdBy ?? null, new Date(Date.now() + hours * HOUR),
  ]);
  return token;
}

interface TokenRow {
  token_hash: string;
  email: string;
  agency_id: string | null;
  user_id: string | null;
  payload: Record<string, unknown>;
  created_by: string | null;
}

/** A token that exists, is the right kind, is unused and hasn't expired; otherwise null. */
async function find(token: string, kind: string): Promise<TokenRow | null> {
  if (!token || token.length < 30 || token.length > 100) return null;
  const [row] = await adminQuery<TokenRow>("select token_hash, email, agency_id, user_id, payload, created_by from auth_tokens where token_hash = $1 and kind = $2 and used_at is null and expires_at > now()", [hashToken(token), kind]);
  return row ?? null;
}

/** Mark a token used. Returns false if someone else used it first, so a link can't be redeemed twice. */
async function spend(hash: string) {
  return (await adminQuery("update auth_tokens set used_at = now() where token_hash = $1 and used_at is null returning 1", [hash])).length === 1;
}

// ── Password reset ───────────────────────────────────────────────────────

/** Always looks the same to the caller, whether or not the email has an account. */
export async function requestPasswordReset(emailIn: string, ip: string) {
  const email = normEmail(emailIn);
  if (!EMAIL.test(email)) throw new UserError("Enter a valid email address.");
  await throttle("reset_request", email, 3, 60);
  await throttle("reset_request", `ip:${ip}`, 10, 60);
  await recordAttempt("reset_request", email);
  await recordAttempt("reset_request", `ip:${ip}`);
  const [user] = await adminQuery<{ id: string; name: string; agency_id: string }>("select id, name, agency_id from users where lower(email) = $1 and active", [email]);
  if (!user) return;
  await adminQuery("update auth_tokens set used_at = now() where kind = 'reset' and user_id = $1 and used_at is null", [user.id]);
  const token = await issue("reset", email, 1, { userId: user.id, agencyId: user.agency_id });
  await sendSystemMail({
    to: email,
    subject: "Reset your 8gency password",
    text: `Hi ${firstName(user.name)},\n\nSomeone asked to reset the password for your 8gency account. Use this link within the hour:\n\n${appUrl(`/reset/${token}`)}\n\nIf it wasn't you, ignore this email. Your password stays as it is.\n\n8gency`,
  });
}

export const resetTokenValid = async (token: string) => Boolean(await find(token, "reset"));

export async function resetPassword(token: string, password: string) {
  const t = await find(token, "reset");
  if (!t || !t.user_id) throw new UserError("That reset link has expired or was already used. Ask for a new one.");
  const problem = passwordProblem(password, t.email);
  if (problem) throw new UserError(problem);
  if (!(await spend(t.token_hash))) throw new UserError("That reset link was already used. Ask for a new one.");
  const hash = await hashPassword(password);
  await adminQuery("update users set password_hash = $2, password_changed_at = now() where id = $1", [t.user_id, hash]);
  // Everyone signed in as this person is signed out, in case someone else had got in.
  await adminQuery("delete from sessions where user_id = $1", [t.user_id]);
  await withTenant({ agencyId: t.agency_id!, userId: t.user_id, actorLabel: "password reset" }, (tx) => tx.audit("user.password_reset", "user", t.user_id, undefined, undefined));
}

// ── Change password, sign out elsewhere ─────────────────────────────────

export async function changePassword(userId: string, agencyId: string, current: string, next: string, keepSessionHash: string | null) {
  const [u] = await adminQuery<{ email: string; password_hash: string }>("select email, password_hash from users where id = $1 and active", [userId]);
  if (!u) throw new UserError("Sign in again.");
  await throttle("login", `change:${userId}`, 5, 15);
  if (!(await verifyPassword(current, u.password_hash))) {
    await recordAttempt("login", `change:${userId}`);
    throw new UserError("Your current password isn't right.");
  }
  const problem = passwordProblem(next, u.email);
  if (problem) throw new UserError(problem);
  if (await verifyPassword(next, u.password_hash)) throw new UserError("Choose a password you haven't used here.");
  await adminQuery("update users set password_hash = $2, password_changed_at = now() where id = $1", [userId, await hashPassword(next)]);
  await adminQuery("delete from sessions where user_id = $1 and token_hash is distinct from $2", [userId, keepSessionHash]);
  await withTenant({ agencyId, userId, actorLabel: "account" }, (tx) => tx.audit("user.password_changed", "user", userId));
}

export async function signOutOtherDevices(userId: string, agencyId: string, keepSessionHash: string | null) {
  const gone = await adminQuery("delete from sessions where user_id = $1 and token_hash is distinct from $2 returning 1", [userId, keepSessionHash]);
  await withTenant({ agencyId, userId, actorLabel: "account" }, (tx) => tx.audit("user.signed_out_elsewhere", "user", userId, undefined, { sessions: gone.length }));
  return gone.length;
}

// ── Team invites ─────────────────────────────────────────────────────────

export interface StaffInvite {
  name: string;
  role: Role;
  title: string;
  team: string | null;
  weekly_hours: number;
  cost_rate_cents: number;
  target_utilisation: number;
}

export async function inviteStaff(agencyId: string, invitedBy: { id: string; name: string }, emailIn: string, invite: StaffInvite) {
  const email = normEmail(emailIn);
  if (!EMAIL.test(email)) throw new UserError("Enter a valid email address.");
  if (!invite.name.trim()) throw new UserError("Add their name.");
  if (await adminQuery("select 1 from users where lower(email) = $1", [email]).then((r) => r.length)) throw new UserError("Someone with that email already has an account.");
  await adminQuery("update auth_tokens set used_at = now() where kind = 'staff_invite' and email = $1 and agency_id = $2 and used_at is null", [email, agencyId]);
  const token = await issue("staff_invite", email, 7 * 24, { agencyId, payload: invite, createdBy: invitedBy.id });
  const [agency] = await adminQuery<{ name: string }>("select name from agencies where id = $1", [agencyId]);
  await sendSystemMail({
    to: email,
    subject: `${invitedBy.name} invited you to ${agency.name} on 8gency`,
    text: `Hi ${firstName(invite.name)},\n\n${invitedBy.name} invited you to join ${agency.name} on 8gency, where the team keeps jobs, time, chat and bookings in one place.\n\nSet your password and you're in (the link works for 7 days):\n\n${appUrl(`/invite/${token}`)}\n\n8gency`,
  });
}

export async function pendingInvites(agencyId: string) {
  return adminQuery<{ token_hash: string; email: string; name: string; expires_at: Date }>(
    "select token_hash, email, payload->>'name' as name, expires_at from auth_tokens where kind = 'staff_invite' and agency_id = $1 and used_at is null and expires_at > now() order by created_at desc",
    [agencyId],
  );
}

export async function revokeInvite(agencyId: string, tokenHash: string) {
  await adminQuery("update auth_tokens set used_at = now() where token_hash = $1 and agency_id = $2 and kind = 'staff_invite' and used_at is null", [tokenHash, agencyId]);
}

export async function staffInviteInfo(token: string) {
  const t = await find(token, "staff_invite");
  if (!t) return null;
  const [agency] = await adminQuery<{ name: string }>("select name from agencies where id = $1", [t.agency_id]);
  return { email: t.email, name: String(t.payload.name ?? ""), agency: agency?.name ?? "your agency" };
}

export async function acceptStaffInvite(token: string, password: string): Promise<{ userId: string; agencyId: string }> {
  const t = await find(token, "staff_invite");
  if (!t || !t.agency_id) throw new UserError("That invitation has expired or was already used. Ask your team for a new one.");
  const problem = passwordProblem(password, t.email);
  if (problem) throw new UserError(problem);
  if (await adminQuery("select 1 from users where lower(email) = $1", [t.email]).then((r) => r.length)) throw new UserError("That email already has an account. Log in instead.");
  if (!(await spend(t.token_hash))) throw new UserError("That invitation was already used.");
  const p = t.payload as unknown as StaffInvite;
  const passwordHash = await hashPassword(password);
  const userId = await withTenant({ agencyId: t.agency_id, userId: t.created_by, actorLabel: `${p.name} (invited)` }, async (tx) => {
    const id = await addTeamMember(tx, { name: p.name, email: t.email, passwordHash, role: p.role, title: p.title, weekly_hours: p.weekly_hours, cost_rate_cents: p.cost_rate_cents, target_utilisation: p.target_utilisation, team: p.team });
    await tx.q("update users set email_verified_at = now(), password_changed_at = now() where id = $1", [id]);
    return id;
  });
  return { userId, agencyId: t.agency_id };
}

// ── Agency invites: sign-up is closed ────────────────────────────────────

/** Used by the invite script: one link for one email, valid 14 days. */
export async function createAgencyInvite(emailIn: string, name = "") {
  const email = normEmail(emailIn);
  if (!EMAIL.test(email)) throw new UserError("That isn't a valid email address.");
  if (await adminQuery("select 1 from users where lower(email) = $1", [email]).then((r) => r.length)) throw new UserError("That email already has an account.");
  await adminQuery("update auth_tokens set used_at = now() where kind = 'agency_invite' and email = $1 and used_at is null", [email]);
  const token = await issue("agency_invite", email, 14 * 24, { payload: { name } });
  await adminQuery("update waitlist set invited_at = now() where lower(email) = $1", [email]);
  const link = appUrl(`/signup?invite=${token}`);
  await sendSystemMail({
    to: email,
    subject: "You're in: set up your agency on 8gency",
    text: `Hi${name ? ` ${firstName(name)}` : ""},\n\nYour spot on 8gency is ready. Set up your agency here (the link works for 14 days):\n\n${link}\n\n8gency`,
  });
  return link;
}

export async function agencyInviteInfo(token: string) {
  const t = await find(token, "agency_invite");
  return t ? { email: t.email, name: String(t.payload.name ?? "") } : null;
}

export async function signupWithInvite(token: string, input: { agencyName: string; agencyType: string; ownerName: string; password: string }) {
  const t = await find(token, "agency_invite");
  if (!t) throw new UserError("That invitation has expired or was already used. Ask for a new one.");
  if (input.agencyName.trim().length < 2) throw new UserError("Agency name is required.");
  if (input.ownerName.trim().length < 2) throw new UserError("Your name is required.");
  if (!AGENCY_TYPES.some((a) => a.key === input.agencyType)) throw new UserError("Choose your agency type.");
  const problem = passwordProblem(input.password, t.email);
  if (problem) throw new UserError(problem);
  if (!(await spend(t.token_hash))) throw new UserError("That invitation was already used.");
  const passwordHash = await hashPassword(input.password);
  return withAdminTx(async (c) => {
    const made = await createAgencyWithOwner(c, { agencyName: input.agencyName.trim(), agencyType: input.agencyType as AgencyType, ownerName: input.ownerName.trim(), email: t.email, passwordHash });
    await c.query("update users set email_verified_at = now(), password_changed_at = now() where id = $1", [made.userId]);
    return made;
  });
}

// ── Waitlist ─────────────────────────────────────────────────────────────

export interface WaitlistInput {
  name: string;
  email: string;
  agencyName: string;
  teamSize: number | null;
  tools: { time: string; projects: string; accounting: string; email: string };
  note: string;
}

export async function joinWaitlist(i: WaitlistInput, ip: string) {
  const email = normEmail(i.email);
  if (!EMAIL.test(email)) throw new UserError("Enter a valid email address.");
  if (i.name.trim().length < 2 || i.agencyName.trim().length < 2) throw new UserError("Add your name and your agency's name.");
  await throttle("waitlist", `ip:${ip}`, 8, 60);
  await recordAttempt("waitlist", `ip:${ip}`);
  const clean = (s: string) => s.trim().slice(0, 80);
  // The same email joining twice just updates its answers: nothing tells a stranger who's on the list.
  await adminQuery(
    `insert into waitlist (email, name, agency_name, team_size, tools, note) values ($1,$2,$3,$4,$5,$6)
     on conflict (lower(email)) do update set name = excluded.name, agency_name = excluded.agency_name, team_size = excluded.team_size, tools = excluded.tools, note = excluded.note`,
    [email, clean(i.name), clean(i.agencyName), i.teamSize && i.teamSize > 0 && i.teamSize < 10000 ? Math.round(i.teamSize) : null, JSON.stringify(Object.fromEntries(Object.entries(i.tools).map(([k, v]) => [k, clean(v)]))), i.note.trim().slice(0, 500)],
  );
}

/** Which tools the waitlist uses, most common first: the roadmap for integrations. */
export async function waitlistDemand() {
  const rows = await adminQuery<{ kind: string; tool: string; n: number }>(
    `select k as kind, lower(btrim(w.tools->>k)) as tool, count(*)::int as n
       from waitlist w cross join unnest(array['time','projects','accounting','email']) as k
      where btrim(coalesce(w.tools->>k, '')) <> '' group by 1, 2 order by 1, 3 desc, 2`,
  );
  return rows;
}

/** For the password step of login: look up by email, time-equalised so a stranger can't tell which emails exist. */
export async function checkLogin(emailIn: string, password: string) {
  const email = normEmail(emailIn);
  const [user] = await adminQuery<{ id: string; agency_id: string; password_hash: string }>("select id, agency_id, password_hash from users where lower(email) = $1 and active", [email]);
  if (!user) {
    await burnPasswordCheck(password);
    return null;
  }
  return (await verifyPassword(password, user.password_hash)) ? user : null;
}
