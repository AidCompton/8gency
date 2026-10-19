// Integration tests against a real Postgres (see README: npm run db:setup && npm run db:migrate).
// Each run creates fresh agencies with unique emails, so it never touches demo data.
import "../scripts/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { adminQuery, closePools, withAdminTx, withTenant, type Tx } from "../src/lib/db";
import { addDays, todayIn } from "../src/lib/domain/dates";
import { addContact, createAgencyWithOwner, createCompany } from "../src/lib/services/agency";
import { createInvoice, readyToBill, sendInvoice, updateDraft } from "../src/lib/services/billing";
import { processInbound } from "../src/lib/services/inbound";
import { addTask, createJob, lockScope, setJobStatus } from "../src/lib/services/jobs";
import { createRetainer, reconcilePeriod } from "../src/lib/services/retainers";
import { clientDecision, createDeliverable, sendToClient, uploadVersion } from "../src/lib/services/review";
import { decideChangeRequest, submitClientRequest } from "../src/lib/services/scope";
import { logTime, startTimer, stopTimer, timesheetSuggestions } from "../src/lib/services/time";

const run = randomUUID().slice(0, 8);
let A: { agencyId: string; userId: string };
let B: { agencyId: string; userId: string };
const asA = <T>(fn: (tx: Tx) => Promise<T>) => withTenant({ agencyId: A.agencyId, userId: A.userId, actorLabel: "Test Owner" }, fn);
const asB = <T>(fn: (tx: Tx) => Promise<T>) => withTenant({ agencyId: B.agencyId, userId: B.userId, actorLabel: "Other Owner" }, fn);

async function readyJob(tx: Tx, companyId: string, opts: { fee?: number; template?: string } = {}) {
  const jobId = await createJob(tx, { company_id: companyId, name: "Test job", template_key: opts.template ?? "design", fee_cents: opts.fee ?? 10_000_00 });
  await tx.q("update briefs set objective='Grow sign-ups by 20% this quarter', audience='Young professionals', key_message='Fast and simple', deliverables='1 poster', must_haves='Logo', budget='R10k', success_measure='Sign-ups' where job_id=$1", [jobId]);
  const approver = await tx.one<{ id: string }>("select id from contacts where company_id = $1 and role = 'approver' limit 1", [companyId]);
  await tx.q("update briefs set approver_contact_id = $2 where job_id = $1", [jobId, approver?.id ?? null]);
  await lockScope(tx, jobId);
  await setJobStatus(tx, jobId, "in_progress");
  return jobId;
}

before(async () => {
  A = await withAdminTx((c) => createAgencyWithOwner(c, { agencyName: `Agency A ${run}`, agencyType: "creative", ownerName: "Test Owner", email: `a-${run}@test.example`, passwordHash: "x" }));
  B = await withAdminTx((c) => createAgencyWithOwner(c, { agencyName: `Agency B ${run}`, agencyType: "creative", ownerName: "Other Owner", email: `b-${run}@test.example`, passwordHash: "x" }));
});

after(async () => {
  await adminQuery("delete from agencies where id = any($1)", [[A.agencyId, B.agencyId]]).catch(() => {});
  await closePools();
});

describe("tenant isolation (row-level security)", () => {
  test("an agency cannot read or write another agency's rows", async () => {
    const secret = await asB((tx) => createCompany(tx, { name: `Secret Client ${run}` }));
    const seenByA = await asA((tx) => tx.q("select id from companies where id = $1", [secret]));
    assert.equal(seenByA.length, 0);
    const updated = await asA((tx) => tx.q("update companies set name = 'hacked' where id = $1 returning id", [secret]));
    assert.equal(updated.length, 0);
    await assert.rejects(
      asA((tx) => tx.q("insert into companies (agency_id, name, code) values ($1, 'Smuggled', 'SMG')", [B.agencyId])),
      /row-level security/,
    );
  });

  test("with no tenant set, the app role sees nothing", async () => {
    const rows = await withTenant({ agencyId: "" }, (tx) => tx.q("select id from agencies"));
    assert.equal(rows.length, 0);
  });

  test("approvals and audit events are immutable", async () => {
    await asA(async (tx) => {
      const companyId = await createCompany(tx, { name: `Immutable ${run}` });
      await tx.q(
        "insert into approvals (agency_id, subject_type, subject_id, stage, decision, approver_name, channel) values ($1,'brief',$2,'client','approved','X','app')",
        [tx.agencyId, companyId],
      );
    });
    await assert.rejects(asA((tx) => tx.q("update approvals set decision = 'declined'")), /immutable/);
    await assert.rejects(asA((tx) => tx.q("delete from audit_events")), /immutable/);
  });
});

describe("operating rules", () => {
  test("no work starts without an approved scope and a complete brief (or a recorded override)", async () => {
    await asA(async (tx) => {
      const companyId = await createCompany(tx, { name: `Rules ${run}` });
      const jobId = await createJob(tx, { company_id: companyId, name: "Unbriefed", template_key: "design", fee_cents: 5_000_00 });
      await assert.rejects(setJobStatus(tx, jobId, "in_progress"), /Approve the scope baseline/);
      await lockScope(tx, jobId);
      await assert.rejects(setJobStatus(tx, jobId, "in_progress"), /brief scores/);
      await setJobStatus(tx, jobId, "in_progress", { overrideReason: "Verbal brief, writing it up today" });
      const job = await tx.one<{ status: string; brief_override_reason: string }>("select status, brief_override_reason from jobs where id = $1", [jobId]);
      assert.equal(job?.status, "in_progress");
      assert.match(job!.brief_override_reason, /Verbal brief/);
    });
  });

  test("out-of-scope time must become a change request or be absorbed with a reason", async () => {
    await asA(async (tx) => {
      const companyId = await createCompany(tx, { name: `OOS ${run}` });
      await addContact(tx, { company_id: companyId, name: "Approver", email: `ap-${run}@client.example`, role: "approver" });
      const jobId = await readyJob(tx, companyId);
      const taskId = await addTask(tx, { job_id: jobId, title: "Extra banner sizes", out_of_scope: true });
      const today = todayIn();
      await assert.rejects(logTime(tx, A.userId, { job_id: jobId, task_id: taskId, work_date: today, hours: 1 }), /out of scope/);
      await assert.rejects(logTime(tx, A.userId, { job_id: jobId, task_id: taskId, work_date: today, hours: 1, oos_resolution: "absorbed" }), /why/);
      await logTime(tx, A.userId, { job_id: jobId, task_id: taskId, work_date: today, hours: 2, oos_resolution: "change_request" });
      const cr = await tx.one<{ id: string; origin: string; estimate_hours: number }>("select id, origin, estimate_hours from change_requests where job_id = $1", [jobId]);
      assert.equal(cr?.origin, "time");
      assert.equal(cr?.estimate_hours, 2);
      // The database enforces the same rule even if application code is bypassed.
      await assert.rejects(
        tx.q("insert into time_entries (agency_id, user_id, job_id, work_date, hours, out_of_scope) values ($1,$2,$3,$4,1,true)", [tx.agencyId, A.userId, jobId, today]),
        /check constraint/,
      );
    });
  });

  test("an approved change request grows the scope baseline and becomes billable", async () => {
    await asA(async (tx) => {
      const companyId = await createCompany(tx, { name: `CR ${run}` });
      const contactId = await addContact(tx, { company_id: companyId, name: "Approver", email: `cr-${run}@client.example`, role: "approver" });
      const jobId = await readyJob(tx, companyId);
      const before = (await tx.one<{ n: number }>("select count(*)::int as n from scope_items where job_id = $1", [jobId]))!.n;
      const { id: reqId, oos } = await submitClientRequest(tx, { company_id: companyId, contact_id: contactId, job_id: jobId, body: "Quick one: can you also do a square version?", channel: "hub" });
      assert.ok(oos.likely, "request should be flagged as possibly out of scope");
      const tasks = (await tx.one<{ n: number }>("select count(*)::int as n from tasks where notes like '%square version%'"))!.n;
      assert.equal(tasks, 0, "requests never land directly on a task list");
      const crId = (await tx.one<{ id: string }>(
        "insert into change_requests (agency_id, company_id, job_id, title, estimate_hours, price_cents, status) values ($1,$2,$3,'Square version',3,300000,'sent') returning id",
        [tx.agencyId, companyId, jobId],
      ))!.id;
      await decideChangeRequest(tx, crId, { decision: "approved", channel: "hub", contactId, approverName: "Approver" });
      const after = (await tx.one<{ n: number }>("select count(*)::int as n from scope_items where job_id = $1", [jobId]))!.n;
      assert.equal(after, before + 1);
      const ready = await readyToBill(tx, companyId);
      assert.ok(ready.some((r) => r.key === `change_request:${crId}` && r.amount_cents === 300000));
      void reqId;
    });
  });

  test("review rounds are counted against scope", async () => {
    await asA(async (tx) => {
      const companyId = await createCompany(tx, { name: `Rounds ${run}` });
      const contactId = await addContact(tx, { company_id: companyId, name: "Approver", email: `rd-${run}@client.example`, role: "approver" });
      const jobId = await readyJob(tx, companyId);
      const scope = await tx.one<{ id: string }>("select id from scope_items where job_id = $1 limit 1", [jobId]);
      await tx.q("update scope_items set rounds_allowed = 1 where id = $1", [scope!.id]);
      const d = await createDeliverable(tx, { job_id: jobId, name: "Poster", scope_item_id: scope!.id, approver_contact_id: contactId, due_date: null });
      await uploadVersion(tx, d, new File(["<svg/>"], "v1.svg", { type: "image/svg+xml" }), "");
      assert.deepEqual(await sendToClient(tx, d), { sent: true });
      await clientDecision(tx, d, { decision: "changes_requested", channel: "email", contactId, approverName: "Approver", note: "Bigger logo" });
      await uploadVersion(tx, d, new File(["<svg/>"], "v2.svg", { type: "image/svg+xml" }), "");
      const second = await sendToClient(tx, d);
      assert.equal(second.sent, false);
      assert.deepEqual(second.needsChangeRequest, { roundsUsed: 1, allowed: 1 });
      assert.deepEqual(await sendToClient(tx, d, { absorbReason: "Our typo" }), { sent: true });
      const absorbed = await tx.one<{ status: string }>("select status from change_requests where deliverable_id = $1", [d]);
      assert.equal(absorbed?.status, "absorbed");
    });
  });

  test("invoices to PO clients cannot be sent without a PO number", async () => {
    await asA(async (tx) => {
      const companyId = await createCompany(tx, { name: `PO ${run}`, po_required: true });
      const jobId = await readyJob(tx, companyId, { fee: 20_000_00, template: "campaign" });
      const items = await readyToBill(tx, companyId);
      assert.ok(items.length > 0, "starting the job should make the deposit billable");
      const inv = await createInvoice(tx, companyId, items.map((i) => i.key));
      await assert.rejects(sendInvoice(tx, inv), /requires a PO number/);
      await updateDraft(tx, inv, { po_number: "PO-123", notes: "", exchange_rate: 1 });
      const number = await sendInvoice(tx, inv);
      assert.match(number, /^INV-\d{5}$/);
      const t = await tx.one<{ subtotal_cents: number; tax_cents: number; total_cents: number }>("select subtotal_cents, tax_cents, total_cents from invoices where id = $1", [inv]);
      assert.equal(t!.tax_cents, Math.round(t!.subtotal_cents * 0.15));
      void jobId;
    });
  });

  test("changing a rate card later never changes historical costing", async () => {
    await asA(async (tx) => {
      const companyId = await createCompany(tx, { name: `Rates ${run}` });
      const jobId = await readyJob(tx, companyId);
      const day = addDays(todayIn(), -2);
      const entry = await logTime(tx, A.userId, { job_id: jobId, work_date: day, hours: 1 });
      const before = (await tx.one<{ rate_cents: number }>("select rate_cents from time_entries where id = $1", [entry]))!.rate_cents;
      assert.ok(before > 0);
      await tx.q("insert into rate_cards (agency_id, role_title, rate_cents, effective_from) values ($1,'Creative Director',999999,current_date)", [tx.agencyId]);
      const afterRate = (await tx.one<{ rate_cents: number }>("select rate_cents from time_entries where id = $1", [entry]))!.rate_cents;
      assert.equal(afterRate, before);
    });
  });

  test("retainer reconciliation applies capped rollover into the next period", async () => {
    await asA(async (tx) => {
      const companyId = await createCompany(tx, { name: `Retainer ${run}` });
      const start = addDays(todayIn(), -45);
      const retainerId = await createRetainer(tx, {
        company_id: companyId, name: "Social", fee_cents: 20_000_00, hours_per_period: 20, start_date: start, rollover: "capped", rollover_cap_hours: 5,
        billing_timing: "advance", price_increase_pct: 0, job_template_key: "social_month", job_owner_id: null, scope: [],
      });
      const periods = await tx.q<{ id: string; starts_on: string }>("select id, starts_on from retainer_periods where retainer_id = $1 order by starts_on", [retainerId]);
      assert.equal(periods.length, 2);
      const job = await tx.one<{ id: string }>("select id from jobs where retainer_id = $1 order by start_date limit 1", [retainerId]);
      await tx.q("update jobs set status = 'in_progress' where id = $1", [job!.id]);
      await logTime(tx, A.userId, { job_id: job!.id, work_date: periods[0].starts_on, hours: 12 });
      const rec = await reconcilePeriod(tx, periods[0].id, "change_request");
      assert.deepEqual(rec, { overageHours: 0, unusedHours: 8, rolloverOutHours: 5, forfeitedHours: 3 });
      const next = await tx.one<{ rollover_in_hours: number }>("select rollover_in_hours from retainer_periods where id = $1", [periods[1].id]);
      assert.equal(next?.rollover_in_hours, 5);
    });
  });
});

describe("pre-filled timesheets", () => {
  test("suggestions come from the person's own activity and stay proportionate to it", async () => {
    await asA(async (tx) => {
      const companyId = await createCompany(tx, { name: `Timesheet ${run}` });
      const jobId = await readyJob(tx, companyId);
      const taskId = await addTask(tx, { job_id: jobId, title: "Layout" });
      await startTimer(tx, A.userId, jobId, taskId);
      assert.equal(await stopTimer(tx, A.userId), null, "a sub-3-minute timer logs nothing");
      const day = todayIn("Africa/Johannesburg");
      const s = await timesheetSuggestions(tx, A.userId, day);
      const forTask = s.find((x) => x.task_id === taskId);
      assert.ok(forTask, "the task worked on today is suggested");
      assert.ok(forTask!.hours <= 1, `one start/stop shouldn't suggest a full day (got ${forTask!.hours}h)`);
    });
    // Another agency's user never sees these suggestions.
    const other = await asB((tx) => timesheetSuggestions(tx, A.userId, todayIn("Africa/Johannesburg")));
    assert.equal(other.length, 0);
  });
});

describe("client channels", () => {
  test("an email reply with the reference code approves the deliverable, only from the right sender", async () => {
    const { deliverableId, code, email } = await asA(async (tx) => {
      const companyId = await createCompany(tx, { name: `Inbound ${run}` });
      const email = `inbound-${run}@client.example`;
      const contactId = await addContact(tx, { company_id: companyId, name: "Naledi", email, phone: "+27 82 555 9999", role: "approver" });
      const jobId = await readyJob(tx, companyId);
      const deliverableId = await createDeliverable(tx, { job_id: jobId, name: "Banner", scope_item_id: null, approver_contact_id: contactId, due_date: null });
      await uploadVersion(tx, deliverableId, new File(["x"], "banner.png", { type: "image/png" }), "");
      await sendToClient(tx, deliverableId);
      const code = (await tx.one<{ code: string }>("select code from action_tokens where subject_id = $1", [deliverableId]))!.code;
      return { deliverableId, code, email };
    });
    const spoofed = await processInbound({ channel: "email", from: "attacker@evil.example", text: `APPROVE ${code}` });
    assert.equal(spoofed.status, "ignored");
    const viaWhatsApp = await processInbound({ channel: "whatsapp", from: "27825559999", text: `👍 ${code}` });
    assert.equal(viaWhatsApp.status, "approved");
    const approval = await asA((tx) =>
      tx.one<{ channel: string; approver_name: string; version_number: number }>("select channel, approver_name, version_number from approvals where subject_id = $1 and stage = 'client'", [deliverableId]),
    );
    assert.deepEqual(approval, { channel: "whatsapp", approver_name: "Naledi", version_number: 1 });
    void email;
  });

  test("a message from a known contact without a code becomes a triage request, never a task", async () => {
    const email = `free-${run}@client.example`;
    await asA(async (tx) => {
      const companyId = await createCompany(tx, { name: `Free text ${run}` });
      await addContact(tx, { company_id: companyId, name: "Thabo", email, role: "commenter" });
    });
    const r = await processInbound({ channel: "email", from: email, text: "While you're at it, can we get a radio script too?" });
    assert.equal(r.status, "request");
    const req = await asA((tx) => tx.one<{ status: string; oos_score: number }>("select status, oos_score from client_requests where body like 'While you''re at it%'"));
    assert.equal(req?.status, "new");
    assert.ok((req?.oos_score ?? 0) >= 30);
  });
});
