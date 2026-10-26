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
import { createJob } from "../src/lib/services/jobs";
import { chatFile, chatHome, createChannel, deleteMessage, ensureClientChannel, ensureDefaults, markRead, messages, restoreMessage, saveChatFile, searchMessages, sendMessage, sidebar, unreadMentions } from "../src/lib/services/chat";
import { sendChatNudges } from "../src/lib/services/chatNudges";
import { sendTimesheetReminders, sendWeeklyEmails } from "../src/lib/services/weekly";
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

describe("chat nudges, search and client groups", () => {
  const as = <T>(userId: string, name: string, fn: Parameters<typeof withTenant<T>>[1]) => withTenant({ agencyId: A.agencyId, userId, actorLabel: name }, fn);
  const mailTo = async (to: string) => (await adminQuery<{ subject: string; body: string }>("select subject, body from system_mail where to_address = $1 order by id", [to]));

  test("an unread mention is emailed once after ten minutes; reading, opting out or switching chat off stops it", async () => {
    const ana = (await adminQuery<{ id: string }>("insert into users (agency_id, email, name, password_hash, role, title) values ($1,$2,'Ana Sender','x','staff','Designer') returning id", [A.agencyId, `ana-${run}@acc.example`]))[0].id;
    const bo = (await adminQuery<{ id: string }>("insert into users (agency_id, email, name, password_hash, role, title) values ($1,$2,'Bo Reader','x','staff','Designer') returning id", [A.agencyId, `bo-${run}@acc.example`]))[0].id;
    const general = await as(ana, "Ana Sender", async (tx) => {
      await ensureDefaults(tx);
      return (await tx.one<{ id: string }>("select id from chat_channels where name = 'general'"))!.id;
    });
    const backdate = () => adminQuery("update notifications set created_at = now() - interval '11 minutes' where user_id = $1 and emailed_at is null", [bo]);
    const ping = (text: string) => as(ana, "Ana Sender", (tx) => sendMessage(tx, general, text));

    await ping("@Bo the poster needle-1 is ready");
    await sendChatNudges();
    assert.equal((await mailTo(`bo-${run}@acc.example`)).length, 0, "not before ten minutes");
    await backdate();
    await sendChatNudges();
    const mail = await mailTo(`bo-${run}@acc.example`);
    assert.equal(mail.length, 1);
    assert.match(mail[0].subject, /Ana mentioned you in #general/);
    assert.match(mail[0].body, /needle-1/);
    assert.match(mail[0].body, /turn them off on your account page/);
    await sendChatNudges();
    assert.equal((await mailTo(`bo-${run}@acc.example`)).length, 1, "only once");

    // Read it in the app first: no email.
    await ping("@Bo needle-2 read me quickly");
    await backdate();
    await as(bo, "Bo Reader", async (tx) => {
      const last = (await messages(tx, general, bo)).pop()!;
      await markRead(tx, general, bo, last.seq);
    });
    await sendChatNudges();
    assert.equal((await mailTo(`bo-${run}@acc.example`)).length, 1, "a message already read in chat isn't emailed");

    // Opted out, or chat switched off for the agency.
    await ping("@Bo needle-3 opted out");
    await backdate();
    await adminQuery("update users set chat_nudges = false where id = $1", [bo]);
    await sendChatNudges();
    await adminQuery("update users set chat_nudges = true where id = $1", [bo]);
    await adminQuery("update agencies set modules = '{\"chat\": false}' where id = $1", [A.agencyId]);
    await sendChatNudges();
    await adminQuery("update agencies set modules = '{}' where id = $1", [A.agencyId]);
    assert.equal((await mailTo(`bo-${run}@acc.example`)).length, 1);
    await sendChatNudges();
    assert.equal((await mailTo(`bo-${run}@acc.example`)).length, 2, "and it arrives once they're back on");

    // Search: public messages for everyone, private ones only for members, % is just a character.
    const secret = await as(ana, "Ana Sender", async (tx) => {
      const id = await createChannel(tx, { name: `hush-${run}`, category: "project", private: true, members: [] });
      await sendMessage(tx, id, "private needle-secret and 100% done");
      return id;
    });
    await as(bo, "Bo Reader", async (tx) => {
      const found = (await searchMessages(tx, bo, "needle-1")).map((r) => r.channel_id);
      assert.deepEqual(found, [general]);
      assert.equal((await searchMessages(tx, bo, "needle-secret")).length, 0, "a private group stays private");
      assert.equal((await searchMessages(tx, bo, "x")).length, 0, "one letter is not a search");
    });
    await as(ana, "Ana Sender", async (tx) => {
      assert.equal((await searchMessages(tx, ana, "needle-secret"))[0].channel_id, secret);
      assert.equal((await searchMessages(tx, ana, "100%")).length, 1);
      assert.equal((await searchMessages(tx, ana, "%%")).length, 0, "a wildcard typed into the box is just text: it doesn't match everything");
    });

    // The Home page: what's unread, who mentioned you, and never a private group you aren't in.
    await ping("@Bo needle-home are you around?");
    await as(ana, "Ana Sender", (tx) => sendMessage(tx, secret, "@Bo this one is private"));
    await as(bo, "Bo Reader", async (tx) => {
      const home = await chatHome(tx, bo);
      assert.ok(home.catchUp.some((x) => x.channel.id === general && /needle-home/.test(x.last?.body ?? "")), "unread conversations come with their latest message");
      const mine = home.mentions.filter((m) => /needle-home|private/.test(m.body));
      assert.deepEqual(mine.map((m) => m.channel_id), [general], "a mention in a private group Bo isn't in stays hidden");
      assert.ok(mine[0].unread);
      assert.equal(home.mentionCount, await unreadMentions(tx, bo));
      assert.ok(home.mentionCount >= 1);
      const last = (await messages(tx, general, bo)).pop()!;
      await markRead(tx, general, bo, last.seq);
      assert.equal(await unreadMentions(tx, bo), 0, "reading the conversation clears the mention badge");
      assert.equal((await chatHome(tx, bo)).mentions.find((m) => /needle-home/.test(m.body))?.unread, false);
    });
  });

  test("a client's group is made once, linked to the client, with the people who work on it", async () => {
    await as(A.userId, "Test Owner", async (tx) => {
      const companyId = await createCompany(tx, { name: `Group Client ${run}` });
      const first = await ensureClientChannel(tx, companyId);
      assert.equal(await ensureClientChannel(tx, companyId), first);
      const c = await tx.one<{ name: string; category: string; company_id: string; private: boolean }>("select name, category, company_id, private from chat_channels where id = $1", [first]);
      assert.deepEqual(c, { name: `group-client-${run}`.slice(0, 40), category: "client", company_id: companyId, private: false });
      assert.ok(await tx.one("select 1 from chat_members where channel_id = $1 and user_id = $2", [first, A.userId]));
    });
  });
});

describe("the weekly rhythm", () => {
  const mailTo = (to: string) => adminQuery<{ subject: string; body: string }>("select subject, body from system_mail where to_address = $1 order by id", [to]);
  // 2026-10-26 is a Monday and 2026-10-30 a Friday; Johannesburg is two hours ahead of UTC.
  const mondayEarly = new Date("2026-10-26T04:30:00Z"), mondayMorning = new Date("2026-10-26T06:30:00Z"), tuesday = new Date("2026-10-27T08:00:00Z");
  const fridayNoon = new Date("2026-10-30T10:00:00Z"), fridayLate = new Date("2026-10-30T13:30:00Z");

  test("the owner gets one Monday email, from seven, with the money and the fixes; it can be switched off", async () => {
    const to = email;
    await adminQuery("update users set weekly_email_sent_on = null where id = $1", [A.userId]);
    const entity = (await adminQuery<{ id: string }>("select id from entities where agency_id = $1 limit 1", [A.agencyId]))[0].id;
    const company = await withTenant({ agencyId: A.agencyId, userId: A.userId, actorLabel: "Test" }, (tx) => createCompany(tx, { name: `Weekly Client ${run}` }));
    await adminQuery("insert into invoices (agency_id, entity_id, company_id, number, status, issue_date, due_date, total_cents) values ($1,$2,$3,$4,'sent',current_date,current_date + 30,250000)", [A.agencyId, entity, company, `W-${run}`]);

    const before = (await mailTo(to)).length;
    await sendWeeklyEmails(mondayEarly);
    await sendWeeklyEmails(tuesday);
    assert.equal((await mailTo(to)).length, before, "not before seven on Monday, and not on other days");
    await sendWeeklyEmails(mondayMorning);
    const mail = await mailTo(to);
    assert.equal(mail.length, before + 1);
    assert.match(mail[mail.length - 1].body, /Billed: R\s?2\s?500/);
    assert.match(mail[mail.length - 1].body, /turn it off on your account page/);
    await sendWeeklyEmails(mondayMorning);
    assert.equal((await mailTo(to)).length, before + 1, "once a week");

    await adminQuery("update users set weekly_email_sent_on = null, weekly_email = false where id = $1", [A.userId]);
    await sendWeeklyEmails(mondayMorning);
    assert.equal((await mailTo(to)).length, before + 1, "opted out");
    await adminQuery("update users set weekly_email = true where id = $1", [A.userId]);
  });

  test("a Friday reminder goes once, after three, to people who log time and have a gap", async () => {
    const id = (await adminQuery<{ id: string }>("insert into users (agency_id, email, name, password_hash, role, title) values ($1,$2,'Cy Logger','x','staff','Designer') returning id", [A.agencyId, `cy-${run}@acc.example`]))[0].id;
    const quiet = (await adminQuery<{ id: string }>("insert into users (agency_id, email, name, password_hash, role, title) values ($1,$2,'Di Quiet','x','staff','Designer') returning id", [A.agencyId, `di-${run}@acc.example`]))[0].id;
    const job = await withTenant({ agencyId: A.agencyId, userId: A.userId, actorLabel: "Test" }, async (tx) => {
      const company = await createCompany(tx, { name: `Timesheet Client ${run}` });
      return createJob(tx, { company_id: company, name: "Gaps", template_key: "blank", budget_hours: 0, billing_model: "tm", owner_id: A.userId });
    });
    await adminQuery("insert into time_entries (agency_id, user_id, job_id, work_date, hours, category, rate_cents, cost_cents, source) values ($1,$2,$3,'2026-10-26',2,'billable',0,0,'manual')", [A.agencyId, id, job]);
    assert.ok(quiet);
    await sendTimesheetReminders(fridayNoon);
    assert.equal((await mailTo(`cy-${run}@acc.example`)).length, 0, "not before three");
    await sendTimesheetReminders(fridayLate);
    const mail = await mailTo(`cy-${run}@acc.example`);
    assert.equal(mail.length, 1);
    assert.match(mail[0].body, /4 weekdays have no time logged/);
    await sendTimesheetReminders(fridayLate);
    assert.equal((await mailTo(`cy-${run}@acc.example`)).length, 1, "once");
    assert.equal((await mailTo(`di-${run}@acc.example`)).length, 0, "people who don't track time aren't nagged");
  });
});

describe("chat threads and attachments", () => {
  const as = <T>(userId: string, name: string, fn: Parameters<typeof withTenant<T>>[1]) => withTenant({ agencyId: A.agencyId, userId, actorLabel: name }, fn);
  const user = async (name: string) => (await adminQuery<{ id: string }>("insert into users (agency_id, email, name, password_hash, role, title) values ($1,$2,$3,'x','staff','Designer') returning id", [A.agencyId, `${name.toLowerCase()}-th-${run}@acc.example`, name]))[0].id;
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

  test("a reply lives in its thread, not the channel, and tells the thread's author", async () => {
    const [ana, bo, cy] = [await user("Thana"), await user("Thbo"), await user("Thcy")];
    const room = await as(ana, "Thana", async (tx) => {
      await ensureDefaults(tx);
      return createChannel(tx, { name: `threads-${run}`, category: "project", private: false, members: [bo, cy] });
    });
    const root = await as(ana, "Thana", async (tx) => {
      const id = await sendMessage(tx, room, "Who can review the deck?");
      return id;
    });
    await as(bo, "Thbo", async (tx) => {
      await sendMessage(tx, room, "I can, give me an hour", "message", { parentId: root });
      await sendMessage(tx, room, "@Thcy can you check the numbers?", "message", { parentId: root });
      await assert.rejects(sendMessage(tx, room, "nested", "message", { parentId: (await messages(tx, room, bo, { parentId: root }))[0].id }), /gone|can't be replied/);
      await assert.rejects(sendMessage(tx, room, "kudos @Thana", "kudos", { parentId: root }), /Kudos go in the channel/);

      const top = (await messages(tx, room, bo)).filter((m) => m.kind === "message");
      assert.deepEqual(top.map((m) => m.body), ["Who can review the deck?"], "replies stay out of the channel");
      assert.equal(top[0].reply_count, 2);
      assert.equal((await messages(tx, room, bo, { parentId: root })).length, 2);
    });
    await as(ana, "Thana", async (tx) => {
      const n = await tx.q<{ title: string }>("select title from notifications where user_id = $1 and title like '%replied to your message%'", [ana]);
      assert.equal(n.length, 2, "the person who started the thread hears about each reply");
      assert.equal((await sidebar(tx, ana)).find((c) => c.id === room)!.unread, 0, "replies don't light up the channel as unread");
    });
    await as(cy, "Thcy", async (tx) => {
      assert.ok((await unreadMentions(tx, cy)) >= 1, "a mention inside a thread still counts");
      assert.equal((await sidebar(tx, cy)).find((c) => c.id === room)!.unread, 1, "only the top-level message is unread in the channel");
    });
  });

  test("files: only allowed kinds, real pictures, shared with whoever can read the conversation", async () => {
    const [ana, bo, outsider] = [await user("Fana"), await user("Fbo"), await user("Fout")];
    const room = await as(ana, "Fana", (tx) => createChannel(tx, { name: `files-${run}`, category: "project", private: true, members: [bo] }));
    const { pic, id, unsent } = await as(ana, "Fana", async (tx) => {
      await assert.rejects(saveChatFile(tx, room, { name: "run.exe", bytes: png }), /isn't allowed/);
      await assert.rejects(saveChatFile(tx, room, { name: "page.html", bytes: png }), /isn't allowed/);
      await assert.rejects(saveChatFile(tx, room, { name: "fake.png", bytes: new Uint8Array([1, 2, 3, 4, 5]) }), /isn't really a picture/);
      await assert.rejects(saveChatFile(tx, room, { name: "big.pdf", bytes: new Uint8Array(10 * 1024 * 1024 + 1) }), /10 MB/);

      const pic = await saveChatFile(tx, room, { name: "../../logo.png", bytes: png });
      const pdf = await saveChatFile(tx, room, { name: "brief.pdf", bytes: new Uint8Array([1, 2, 3]) });
      assert.ok(!pic.name.includes("/"), "no path in the name");
      assert.ok(pic.image && !pdf.image);
      assert.ok(pdf.placeholder === null && pdf.width === null, "only pictures get a placeholder");
      const sharp = (await import("sharp")).default;
      const real = await saveChatFile(tx, room, { name: "banner.png", bytes: await sharp({ create: { width: 300, height: 120, channels: 3, background: "#7c5cff" } }).png().toBuffer() });
      assert.deepEqual([real.width, real.height], [300, 120]);
      assert.match(real.placeholder ?? "", /^data:image\/jpeg;base64,/);
      assert.ok((real.placeholder ?? "").length < 2000, "the placeholder is tiny");
      await assert.rejects(sendMessage(tx, room, "", "message", { fileIds: [randomUUID()] }), /didn't upload/);
      const id = await sendMessage(tx, room, "", "message", { fileIds: [pic.id, pdf.id] });
      const m = (await messages(tx, room, ana)).find((x) => x.id === id)!;
      assert.deepEqual(m.files.map((f) => f.name).sort(), [pdf.name, pic.name].sort());
      assert.equal(m.body, "");
      return { pic, id, unsent: await saveChatFile(tx, room, { name: "draft.txt", bytes: new Uint8Array([65]) }) };
    });
    await as(bo, "Fbo", async (tx) => {
      assert.equal((await chatFile(tx, pic.id)).mime, "image/png", "a member can open it");
      await assert.rejects(chatFile(tx, unsent.id), /isn't there/, "an unsent upload is only for who uploaded it");
      await assert.rejects(sendMessage(tx, room, "mine now", "message", { fileIds: [unsent.id] }), /didn't upload/, "nobody can send someone else's upload");
    });
    await as(outsider, "Fout", async (tx) => {
      await assert.rejects(chatFile(tx, pic.id), /private|doesn't exist/, "not a member of a private group: no file");
    });
    await as(ana, "Fana", async (tx) => {
      await deleteMessage(tx, id, false);
      await assert.rejects(chatFile(tx, pic.id), /isn't there/, "a deleted message's files are gone from view");
    });
    await as(bo, "Fbo", (tx) => assert.rejects(restoreMessage(tx, id, false), /only restore your own/));
    await as(ana, "Fana", async (tx) => {
      await restoreMessage(tx, id, false);
      assert.equal((await chatFile(tx, pic.id)).mime, "image/png", "Undo brings the message and its files back");
      assert.ok((await messages(tx, room, ana)).some((m) => m.id === id && !m.deleted));
    });
    await adminQuery("update chat_messages set deleted_at = now() - interval '2 hours' where id = $1", [id]);
    await as(ana, "Fana", (tx) => assert.rejects(restoreMessage(tx, id, false), /can't be restored/));
  });
});
