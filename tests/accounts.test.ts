// Account security against Postgres: login throttling, password reset, change
// password, team invites, closed sign-up and the waitlist.
import "../scripts/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { adminQuery, closePools, withAdminTx, withTenant } from "../src/lib/db";
import { hashPassword, hashToken, passwordProblem, verifyPassword } from "../src/lib/passwords";
import { recordAttempt, throttle } from "../src/lib/security";
import {
  acceptStaffInvite, agencyInviteInfo, changePassword, checkLogin, createAgencyInvite, inviteStaff, joinWaitlist, requestPasswordReset, resetPassword,
  signupWithInvite, signOutOtherDevices, waitlistDemand,
} from "../src/lib/services/accountAuth";
import { addContact, createAgencyWithOwner, createCompany } from "../src/lib/services/agency";
import { ensureHubToken } from "../src/lib/services/core";
import { resolveHubToken } from "../src/lib/services/hub";

const run = randomUUID().slice(0, 8);
const email = `owner-${run}@acc.example`;
const oldPassword = "correct horse battery";
let A: { agencyId: string; userId: string };

/** The link in the newest account email sent to an address. */
async function lastLink(to: string, path: string) {
  const [m] = await adminQuery<{ body: string }>("select body from system_mail where to_address = $1 order by id desc limit 1", [to]);
  const hit = m.body.match(new RegExp(`${path}[A-Za-z0-9_-]+`));
  assert.ok(hit, `no ${path} link in the email to ${to}`);
  return hit![0].slice(path.length);
}
const addSession = async (userId: string, agencyId: string, tag: string) => {
  const hash = hashToken(`${tag}-${run}`);
  await adminQuery("insert into sessions (token_hash, user_id, agency_id, expires_at) values ($1,$2,$3, now() + interval '1 day')", [hash, userId, agencyId]);
  return hash;
};

before(async () => {
  A = await withAdminTx((c) => createAgencyWithOwner(c, { agencyName: `Accounts ${run}`, agencyType: "creative", ownerName: "Ada Owner", email, passwordHash: "x" }));
  await adminQuery("update users set password_hash = $2 where id = $1", [A.userId, await hashPassword(oldPassword)]);
});

after(async () => {
  await adminQuery("delete from agencies where id = $1", [A.agencyId]).catch(() => {});
  await adminQuery("delete from auth_tokens where email like $1", [`%${run}%`]);
  await adminQuery("delete from waitlist where email like $1", [`%${run}%`]);
  await adminQuery("delete from system_mail where to_address like $1", [`%${run}%`]);
  await adminQuery("delete from auth_attempts where identifier like $1", [`%${run}%`]);
  await closePools();
});

describe("passwords", () => {
  test("new passwords need length and can't be the email or an obvious one", () => {
    assert.match(passwordProblem("short")!, /at least 10/);
    assert.match(passwordProblem("Ada@Example.com", "ada@example.com")!, /email/);
    assert.match(passwordProblem("password123456")!, /too easy/);
    assert.equal(passwordProblem("correct horse battery"), null);
  });
});

describe("login throttling", () => {
  test("five wrong guesses lock the email; a success on another run clears the count; IPs are limited separately", async () => {
    const id = `guess-${run}@acc.example`;
    for (let i = 0; i < 5; i++) {
      await throttle("login", id, 5, 15, { resetOnSuccess: true });
      await recordAttempt("login", id);
    }
    await assert.rejects(throttle("login", id, 5, 15, { resetOnSuccess: true }), /Too many attempts\. Try again in about \d+ minutes?\./);
    await recordAttempt("login", id, true); // the real owner got in
    await throttle("login", id, 5, 15, { resetOnSuccess: true });

    const ip = `ip:10.0.0.${Math.floor(Math.random() * 200)}-${run}`;
    for (let i = 0; i < 25; i++) await recordAttempt("login", ip);
    await recordAttempt("login", ip, true); // an attacker's own good login must NOT clear the IP count
    await assert.rejects(throttle("login", ip, 25, 15), /Too many attempts/);
  });

  test("a wrong password and an unknown email look identical; the right one works", async () => {
    assert.equal(await checkLogin(email, "not the password"), null);
    assert.equal(await checkLogin(`nobody-${run}@acc.example`, "not the password"), null);
    assert.equal((await checkLogin(email.toUpperCase(), oldPassword))?.id, A.userId);
  });
});

describe("password reset", () => {
  test("a link works once, signs everyone out, and unknown emails reveal nothing", async () => {
    const other = await addSession(A.userId, A.agencyId, "laptop");
    await requestPasswordReset(`stranger-${run}@acc.example`, `reset-ip-${run}`); // no error, no email
    assert.equal((await adminQuery("select 1 from system_mail where to_address = $1", [`stranger-${run}@acc.example`])).length, 0);

    await requestPasswordReset(email, `reset-ip-${run}`);
    const token = await lastLink(email, "/reset/");
    await assert.rejects(resetPassword(token, "short"), /at least 10/);
    await resetPassword(token, "brand new passphrase");
    await assert.rejects(resetPassword(token, "another passphrase here"), /expired or was already used/);
    assert.equal(await checkLogin(email, oldPassword), null);
    assert.ok(await checkLogin(email, "brand new passphrase"));
    assert.equal((await adminQuery("select 1 from sessions where token_hash = $1", [other])).length, 0);
    assert.ok((await adminQuery("select 1 from audit_events where action = 'user.password_reset' and record_id = $1", [A.userId])).length >= 1);
  });

  test("only the newest link works, and reset requests are limited", async () => {
    await requestPasswordReset(email, `ip-b-${run}`);
    const first = await lastLink(email, "/reset/");
    await requestPasswordReset(email, `ip-c-${run}`);
    const second = await lastLink(email, "/reset/");
    await assert.rejects(resetPassword(first, "yet another passphrase"), /expired or was already used/);
    await resetPassword(second, "final passphrase here");
    await assert.rejects(requestPasswordReset(email, `ip-d-${run}`), /Too many attempts/);
  });
});

describe("change password", () => {
  test("needs the current password, keeps this device, signs out the rest", async () => {
    const mine = await addSession(A.userId, A.agencyId, "mine");
    const theirs = await addSession(A.userId, A.agencyId, "theirs");
    await assert.rejects(changePassword(A.userId, A.agencyId, "wrong current", "a fresh passphrase!", mine), /current password isn't right/);
    await assert.rejects(changePassword(A.userId, A.agencyId, "final passphrase here", "final passphrase here", mine), /haven't used/);
    await changePassword(A.userId, A.agencyId, "final passphrase here", "a fresh passphrase!", mine);
    const left = (await adminQuery<{ token_hash: string }>("select token_hash from sessions where user_id = $1", [A.userId])).map((r) => r.token_hash);
    assert.deepEqual(left, [mine]);
    assert.ok(!left.includes(theirs));
    const third = await addSession(A.userId, A.agencyId, "third");
    assert.equal(await signOutOtherDevices(A.userId, A.agencyId, mine), 1);
    assert.ok(third);
  });
});

describe("team invites", () => {
  test("an invite creates the account once, verified, with the role it was sent with", async () => {
    const to = `newbie-${run}@acc.example`;
    await assert.rejects(inviteStaff(A.agencyId, { id: A.userId, name: "Ada Owner" }, email, { name: "X", role: "staff", title: "Designer", team: "design", weekly_hours: 40, cost_rate_cents: 0, target_utilisation: 0.7 }), /already has an account/);
    await inviteStaff(A.agencyId, { id: A.userId, name: "Ada Owner" }, to, { name: "Nia Newbie", role: "pm", title: "Project Manager", team: "management", weekly_hours: 32, cost_rate_cents: 30000, target_utilisation: 0.6 });
    const token = await lastLink(to, "/invite/");
    await assert.rejects(acceptStaffInvite(token, "tiny"), /at least 10/);
    const made = await acceptStaffInvite(token, "newbie passphrase");
    assert.equal(made.agencyId, A.agencyId);
    const [u] = await adminQuery<{ role: string; weekly_hours: number; email_verified_at: Date | null; password_hash: string }>("select role, weekly_hours::float, email_verified_at, password_hash from users where id = $1", [made.userId]);
    assert.deepEqual([u.role, u.weekly_hours, !!u.email_verified_at], ["pm", 32, true]);
    assert.ok(await verifyPassword("newbie passphrase", u.password_hash));
    await assert.rejects(acceptStaffInvite(token, "newbie passphrase"), /expired or was already used/);
  });

  test("a newer invite replaces the older one", async () => {
    const to = `again-${run}@acc.example`;
    const inv = { name: "Al Again", role: "staff" as const, title: "Designer", team: "design", weekly_hours: 40, cost_rate_cents: 0, target_utilisation: 0.7 };
    await inviteStaff(A.agencyId, { id: A.userId, name: "Ada Owner" }, to, inv);
    const old = await lastLink(to, "/invite/");
    await inviteStaff(A.agencyId, { id: A.userId, name: "Ada Owner" }, to, inv);
    await assert.rejects(acceptStaffInvite(old, "again passphrase!"), /expired or was already used/);
    await acceptStaffInvite(await lastLink(to, "/invite/"), "again passphrase!");
  });
});

describe("closed sign-up", () => {
  test("an agency can only be created from an invite, for that email, once", async () => {
    const to = `founder-${run}@acc.example`;
    const link = await createAgencyInvite(to, "Fran Founder");
    const token = link.split("invite=")[1];
    assert.deepEqual(await agencyInviteInfo(token), { email: to, name: "Fran Founder" });
    assert.equal(await agencyInviteInfo("not-a-real-token-not-a-real-token-xx"), null);
    await assert.rejects(signupWithInvite(token, { agencyName: "F", agencyType: "creative", ownerName: "Fran", password: "founder passphrase" }), /Agency name/);
    const made = await signupWithInvite(token, { agencyName: `Founder Co ${run}`, agencyType: "creative", ownerName: "Fran Founder", password: "founder passphrase" });
    const [u] = await adminQuery<{ email: string; email_verified_at: Date | null }>("select email, email_verified_at from users where id = $1", [made.userId]);
    assert.deepEqual([u.email, !!u.email_verified_at], [to, true]);
    await assert.rejects(signupWithInvite(token, { agencyName: `Again ${run}`, agencyType: "creative", ownerName: "Fran", password: "founder passphrase" }), /expired or was already used/);
    await assert.rejects(createAgencyInvite(to), /already has an account/);
    await adminQuery("delete from agencies where id = $1", [made.agencyId]);
  });
});

describe("waitlist", () => {
  test("joining twice updates one row, and the tools they use are counted", async () => {
    const to = `wait-${run}@acc.example`;
    const tools = { time: "Toggl", projects: "Trello", accounting: "Xero", email: "Google Workspace" };
    await joinWaitlist({ name: "Wes Waiting", email: to, agencyName: "Waiting Co", teamSize: 4, tools, note: "" }, `wl-ip-${run}`);
    await joinWaitlist({ name: "Wes Waiting", email: to.toUpperCase(), agencyName: "Waiting Co", teamSize: 5, tools: { ...tools, accounting: "Sage" }, note: "" }, `wl-ip-${run}`);
    const rows = await adminQuery<{ team_size: number; tools: { accounting: string } }>("select team_size, tools from waitlist where email like $1", [`%${run}%`]);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].team_size, rows[0].tools.accounting], [5, "Sage"]);
    assert.ok((await waitlistDemand()).some((d) => d.kind === "accounting" && d.tool === "sage"));
    await assert.rejects(joinWaitlist({ name: "A", email: "not-an-email", agencyName: "B", teamSize: 3, tools, note: "" }, `wl-ip-${run}`), /valid email/);
  });
});

describe("client hub links", () => {
  test("expire 60 days after last use, never after a fixed date, and expired ones stop working", async () => {
    const { contactId } = await withTenant({ agencyId: A.agencyId, userId: A.userId, actorLabel: "Test" }, async (tx) => {
      const companyId = await createCompany(tx, { name: `Hub Client ${run}` });
      return { contactId: await addContact(tx, { company_id: companyId, name: "Hub Contact", email: `hub-${run}@acc.example`, role: "approver" }) };
    });
    const days = async () => Math.round((await adminQuery<{ d: number }>("select extract(epoch from hub_token_expires_at - now())::float / 86400 as d from contacts where id = $1", [contactId]))[0].d);
    const token = await withTenant({ agencyId: A.agencyId, userId: A.userId, actorLabel: "Test" }, (tx) => ensureHubToken(tx, contactId));
    assert.ok((await days()) > 59 && (await days()) <= 60, "a new link lasts 60 days");

    await adminQuery("update contacts set hub_token_expires_at = now() + interval '10 days' where id = $1", [contactId]);
    assert.equal((await resolveHubToken(token))?.id, contactId);
    assert.ok((await days()) > 59, "using a link renews it");

    await adminQuery("update contacts set hub_token_expires_at = now() + interval '59 days' where id = $1", [contactId]);
    await resolveHubToken(token);
    assert.ok((await days()) <= 59.01, "a recently renewed link isn't rewritten on every page view");

    await adminQuery("update contacts set hub_token_expires_at = now() - interval '1 minute' where id = $1", [contactId]);
    assert.equal(await resolveHubToken(token), null, "expired links are refused");

    await adminQuery("update contacts set hub_token_expires_at = now() + interval '3 days' where id = $1", [contactId]);
    const again = await withTenant({ agencyId: A.agencyId, userId: A.userId, actorLabel: "Test" }, (tx) => ensureHubToken(tx, contactId));
    assert.equal(again, token);
    assert.ok((await days()) > 59, "sending the link again gives it a full 60 days");

    await adminQuery("update contacts set hub_token = null, hub_token_expires_at = null where id = $1", [contactId]);
    assert.equal(await resolveHubToken(token), null, "a revoked link stops working at once");
  });
});
