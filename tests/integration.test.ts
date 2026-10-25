// Integration tests against a real Postgres (see README: npm run db:setup && npm run db:migrate).
// Each run creates fresh agencies with unique emails, so it never touches demo data.
import "../scripts/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { adminQuery, closePools, withAdminTx, withTenant, type Tx } from "../src/lib/db";
import { addDays, isWeekday, todayIn } from "../src/lib/domain/dates";
import { addContact, createAgencyWithOwner, createCompany, setAgencyLogo } from "../src/lib/services/agency";
import { createInvoice, readyToBill, recordPayment, saveDraftInvoice, sendInvoice, syncUnbilledTime, type DraftInvoiceEdit } from "../src/lib/services/billing";
import { TEMPLATES } from "../src/lib/domain/automations";
import { enabledBuiltins, runScheduledAutomations } from "../src/lib/services/automationEngine";
import { saveAutomation, setAutomationEnabled, validateFlow, runAutomations } from "../src/lib/services/automations";
import { processInbound } from "../src/lib/services/inbound";
import { addTask, createJob, lockScope, setJobBillTime, setJobStatus } from "../src/lib/services/jobs";
import { createRetainer, reconcilePeriod } from "../src/lib/services/retainers";
import { clientDecision, createDeliverable, sendToClient, uploadVersion } from "../src/lib/services/review";
import { decideChangeRequest, submitClientRequest } from "../src/lib/services/scope";
import { teamTimesheet, teamWorkload } from "../src/lib/services/team";
import { cancelBooking, createBooking, declineBooking } from "../src/lib/services/bookings";
import { channelFor, createChannel, deleteMessage, editMessage, ensureDefaults, leaveChannel, markRead, messages, openDirect, sendMessage, toggleReaction, unreadTotal } from "../src/lib/services/chat";
import { deleteTimeEntry, logTime, startTimer, stopTimer, timesheetSuggestions } from "../src/lib/services/time";

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
      const lines = await tx.q<{ id: string; description: string; quantity: number; unit_cents: number }>("select id, description, quantity, unit_cents from invoice_lines where invoice_id = $1 order by sort", [inv]);
      await saveDraftInvoice(tx, inv, { lines, po_number: "PO-123", notes: "", due_date: null, tax_rate: 0.15, exchange_rate: 1 });
      const number = await sendInvoice(tx, inv);
      assert.match(number, /^INV-\d{5}$/);
      const t = await tx.one<{ subtotal_cents: number; tax_cents: number; total_cents: number }>("select subtotal_cents, tax_cents, total_cents from invoices where id = $1", [inv]);
      assert.equal(t!.tax_cents, Math.round(t!.subtotal_cents * 0.15));
      void jobId;
    });
  });

  test("draft invoices are fully editable; removed lines go back to ready-to-bill; issued invoices are locked", async () => {
    await asA(async (tx) => {
      const companyId = await createCompany(tx, { name: `Edit ${run}` });
      await readyJob(tx, companyId, { fee: 20_000_00, template: "campaign" });
      const items = await readyToBill(tx, companyId);
      const inv = await createInvoice(tx, companyId, items.map((i) => i.key));
      const [first] = await tx.q<{ id: string; description: string; quantity: number; unit_cents: number; source_type: string }>(
        "select id, description, quantity, unit_cents, source_type from invoice_lines where invoice_id = $1 order by sort",
        [inv],
      );
      assert.equal(first.source_type, "milestone");
      assert.equal((await readyToBill(tx, companyId)).length, 0, "billed items leave the queue");

      const edit = (lines: DraftInvoiceEdit["lines"], extra: Partial<DraftInvoiceEdit> = {}): DraftInvoiceEdit => ({ lines, po_number: "", notes: "", due_date: null, tax_rate: 0.15, exchange_rate: 1, ...extra });
      // Remove the milestone line, add two manual lines (one blank row is ignored), zero-rate the tax, set a due date.
      const due = addDays(todayIn(), 10);
      await saveDraftInvoice(tx, inv, edit([{ description: "Strategy workshop", quantity: 2, unit_cents: 1500_00 }, { description: "Travel", quantity: 1, unit_cents: 450_50 }, { description: "", quantity: 1, unit_cents: 0 }], { tax_rate: 0, due_date: due }));
      const t = await tx.one<{ subtotal_cents: number; tax_cents: number; total_cents: number; due_date: string }>("select subtotal_cents, tax_cents, total_cents, due_date::text from invoices where id = $1", [inv]);
      assert.deepEqual({ ...t }, { subtotal_cents: 3450_50, tax_cents: 0, total_cents: 3450_50, due_date: due });
      assert.equal(await tx.one<{ n: number }>("select count(*)::int as n from invoice_lines where invoice_id = $1", [inv]).then((r) => r!.n), 2);
      assert.ok((await readyToBill(tx, companyId)).some((i) => i.key === items[0].key), "the removed milestone is billable again");

      // Edit an existing line in place.
      const kept = await tx.q<{ id: string; description: string; quantity: number; unit_cents: number }>("select id, description, quantity, unit_cents from invoice_lines where invoice_id = $1 order by sort", [inv]);
      await saveDraftInvoice(tx, inv, edit([{ ...kept[0], quantity: 3 }, kept[1]], { tax_rate: 0, due_date: due }));
      assert.equal((await tx.one<{ total_cents: number }>("select total_cents from invoices where id = $1", [inv]))!.total_cents, 4950_50);

      await assert.rejects(saveDraftInvoice(tx, inv, edit([])), /at least one line/);
      await assert.rejects(saveDraftInvoice(tx, inv, edit([{ ...kept[0], description: " " }])), /needs a description/);
      await assert.rejects(saveDraftInvoice(tx, inv, edit([{ ...kept[0], quantity: 0 }])), /Quantity must be more than zero/);

      await sendInvoice(tx, inv);
      assert.equal((await tx.one<{ due_date: string }>("select due_date::text from invoices where id = $1", [inv]))!.due_date, due, "a due date set on the draft is kept");
      await assert.rejects(saveDraftInvoice(tx, inv, edit(kept)), /Only draft invoices/);
    });
  });

  test("billable time goes onto the client's next invoice by itself, itemised by task and rate", async () => {
    await asA(async (tx) => {
      const companyId = await createCompany(tx, { name: `Time ${run}` });
      const drafts = () => tx.q<{ id: string }>("select id from invoices where company_id = $1 and status = 'draft'", [companyId]);
      const timeLines = (inv: string) =>
        tx.q<{ id: string; description: string; quantity: number; unit_cents: number; task_id: string | null; job_id: string }>(
          "select id, description, quantity, unit_cents, task_id, job_id from invoice_lines where invoice_id = $1 and source_type = 'time' order by sort",
          [inv],
        );
      const day = addDays(todayIn(), -1);

      // Hourly job: billed by default. Two tasks → two itemised lines on a draft nobody had to create.
      const tm = await createJob(tx, { company_id: companyId, name: "Hourly work", template_key: "design", billing_model: "tm" });
      const [t1, t2] = await tx.q<{ id: string; title: string }>("select id, title from tasks where job_id = $1 order by title limit 2", [tm]);
      const e1 = await logTime(tx, A.userId, { job_id: tm, task_id: t1.id, work_date: day, hours: 2, notes: "Homepage hero concepts" });
      await logTime(tx, A.userId, { job_id: tm, task_id: t2.id, work_date: day, hours: 1.5 });
      const [draft] = await drafts();
      assert.ok(draft, "a draft was started automatically");
      let lines = await timeLines(draft.id);
      assert.equal(lines.length, 2);
      const l1 = lines.find((l) => l.task_id === t1.id)!;
      assert.equal(Number(l1.quantity), 2);
      assert.ok(l1.unit_cents > 0, "billed at the rate card rate");
      assert.ok(l1.description.includes(t1.title), "the line says which task the time was for");

      // More time on the same task tops up the same line; deleting an entry takes it off again.
      const e3 = await logTime(tx, A.userId, { job_id: tm, task_id: t1.id, work_date: day, hours: 1, notes: "Mobile layout" });
      lines = await timeLines(draft.id);
      assert.equal(lines.length, 2);
      assert.equal(Number(lines.find((l) => l.task_id === t1.id)!.quantity), 3);
      assert.match(lines.find((l) => l.task_id === t1.id)!.description, / — Homepage hero concepts; Mobile layout$/, "time notes say what was done");
      await deleteTimeEntry(tx, A.userId, e3);
      assert.equal(Number((await timeLines(draft.id)).find((l) => l.task_id === t1.id)!.quantity), 2);

      // Fixed-fee job: time is tracked but not billed, until the job is switched on.
      const fixed = await createJob(tx, { company_id: companyId, name: "Fixed work", template_key: "design", billing_model: "fixed", fee_cents: 50_000_00 });
      const fe = await logTime(tx, A.userId, { job_id: fixed, work_date: day, hours: 4 });
      assert.equal((await timeLines(draft.id)).length, 2, "fixed-fee time stays off the invoice");
      await setJobBillTime(tx, fixed, "from_today");
      assert.equal((await timeLines(draft.id)).length, 2, "'from today' leaves yesterday's time alone");
      await setJobBillTime(tx, fixed, "all");
      lines = await timeLines(draft.id);
      assert.equal(lines.length, 3, "'all' sweeps up time already logged");

      // Removing a time line from the draft means "don't charge it": it doesn't come back.
      const keep = lines.filter((l) => l.job_id !== fixed);
      await saveDraftInvoice(tx, draft.id, { lines: keep, po_number: "", notes: "", due_date: null, tax_rate: 0.15, exchange_rate: 1 });
      await syncUnbilledTime(tx, companyId);
      assert.equal((await timeLines(draft.id)).length, 2);
      assert.equal((await tx.one<{ not_billed: boolean }>("select not_billed from time_entries where id = $1", [fe]))!.not_billed, true);

      // Imported time (history from another tool) is never added by itself: it waits in Ready to bill for a person.
      await tx.q(
        `insert into time_entries (agency_id, user_id, job_id, task_id, work_date, hours, category, rate_cents, source)
         values ($1, $2, $3, $4, $5, 5, 'billable', 100000, 'import')`,
        [tx.agencyId, A.userId, tm, t2.id, addDays(day, -30)],
      );
      await syncUnbilledTime(tx, companyId);
      assert.equal((await timeLines(draft.id)).length, 2, "imported time isn't billed automatically");
      const imported = (await readyToBill(tx, companyId)).find((i) => i.source_type === "time" && i.source_id === tm);
      assert.ok(imported, "imported time is offered in Ready to bill");
      assert.equal(Number(imported.quantity), 5);

      // Ready-to-bill items (milestones, confirmed imported time) join the same next invoice rather than starting another.
      await readyJob(tx, companyId, { fee: 20_000_00, template: "campaign" });
      const items = await readyToBill(tx, companyId);
      assert.equal(await createInvoice(tx, companyId, items.map((i) => i.key)), draft.id);
      assert.ok((await timeLines(draft.id)).some((l) => l.task_id === t2.id && l.unit_cents === 100000 && Number(l.quantity) === 5), "imported time is itemised like any other time");

      // Once issued, the next time logged starts the next invoice; issued time can't be deleted.
      await sendInvoice(tx, draft.id);
      await logTime(tx, A.userId, { job_id: tm, task_id: t2.id, work_date: todayIn(), hours: 1 });
      const next = await drafts();
      assert.equal(next.length, 1);
      assert.notEqual(next[0].id, draft.id);
      assert.equal((await timeLines(next[0].id)).length, 1);
      await assert.rejects(deleteTimeEntry(tx, A.userId, e1), /locked|issued/);

      // Deleting the only time on a draft removes the empty draft too.
      const only = (await tx.one<{ id: string }>("select id from time_entries where invoice_line_id in (select id from invoice_lines where invoice_id = $1)", [next[0].id]))!.id;
      await deleteTimeEntry(tx, A.userId, only);
      assert.equal((await drafts()).length, 0);
    });
  });

  test("automations: events, filters, scheduled triggers, contained failures and built-in switches", async () => {
    await asA(async (tx) => {
      const companyId = await createCompany(tx, { name: `Auto ${run}` });
      const other = await createCompany(tx, { name: `Other ${run}` });
      await addContact(tx, { company_id: companyId, name: "Bea Billing", email: `bill-${run}@client.example`, phone: "+27820000000", role: "billing" });
      const runs = (id: string) => tx.q<{ status: string; summary: string; record_key: string }>("select status, summary, record_key from automation_runs where automation_id = $1 order by created_at", [id]);

      // A template, used as-is: thank the client when an invoice is paid. Filtered to this client only.
      const thanks = TEMPLATES.find((t) => t.key === "thank_on_payment")!;
      const auto = await saveAutomation(tx, null, { name: thanks.name, description: "", enabled: true, flow: { ...thanks.flow, filters: [{ field: "company_id", value: companyId }] } });
      // Broken on purpose: an invoice has no job, so "create a task" fails. The payment must still go through.
      const broken = await saveAutomation(tx, null, { name: "Broken", description: "", enabled: true, flow: { trigger: { type: "invoice.paid", config: {} }, filters: [], actions: [{ type: "create_task", config: { title: "x", assignee: "unassigned", due_in_days: 1 } }] } });

      await readyJob(tx, companyId, { fee: 20_000_00, template: "campaign" });
      const inv = await createInvoice(tx, companyId, (await readyToBill(tx, companyId)).map((i) => i.key));
      await sendInvoice(tx, inv);
      const total = (await tx.one<{ total_cents: number }>("select total_cents from invoices where id = $1", [inv]))!.total_cents;
      await recordPayment(tx, inv, total, "EFT");
      assert.equal((await tx.one<{ status: string }>("select status from invoices where id = $1", [inv]))!.status, "paid", "a failing automation never blocks the payment");

      const [ok] = await runs(auto);
      assert.equal(ok.status, "ok");
      const mail = await tx.one<{ subject: string; body: string; to_address: string }>("select subject, body, to_address from outbox_messages where related_type = 'automation' and related_id = $1", [auto]);
      assert.equal(mail?.to_address, `bill-${run}@client.example`);
      assert.match(mail!.subject, /^Payment received: INV-/);
      assert.match(mail!.body, /^Hi Bea,/);
      const [bad] = await runs(broken);
      assert.equal(bad.status, "error");
      assert.match(bad.summary, /nowhere to add the task/);

      // The filter keeps it to its client: another client's payment doesn't trigger it.
      await readyJob(tx, other, { fee: 20_000_00, template: "campaign" });
      const inv2 = await createInvoice(tx, other, (await readyToBill(tx, other)).map((i) => i.key));
      await sendInvoice(tx, inv2);
      await recordPayment(tx, inv2, (await tx.one<{ total_cents: number }>("select total_cents from invoices where id = $1", [inv2]))!.total_cents, "EFT");
      assert.equal((await runs(auto)).length, 1);

      // Scheduled: an overdue invoice gets one WhatsApp, however often the scheduler runs.
      const nudge = TEMPLATES.find((t) => t.key === "overdue_whatsapp")!;
      const wa = await saveAutomation(tx, null, { name: nudge.name, description: "", enabled: true, flow: { ...nudge.flow, filters: [{ field: "company_id", value: companyId }] } });
      await readyJob(tx, companyId, { fee: 30_000_00, template: "campaign" });
      const late = await createInvoice(tx, companyId, (await readyToBill(tx, companyId)).map((i) => i.key));
      await sendInvoice(tx, late);
      await tx.q("update invoices set due_date = $2 where id = $1", [late, addDays(todayIn(), -9)]);
      await runScheduledAutomations(tx);
      await runScheduledAutomations(tx);
      const waRuns = await runs(wa);
      assert.equal(waRuns.length, 1);
      assert.equal(waRuns[0].status, "ok");
      const msg = await tx.one<{ channel: string; body: string }>("select channel, body from outbox_messages where related_type = 'automation' and related_id = $1", [wa]);
      assert.equal(msg?.channel, "whatsapp");
      assert.match(msg!.body, /9 days overdue/);

      // Switched off = doesn't run.
      await setAutomationEnabled(tx, auto, false);
      assert.equal((await tx.q("select 1 from automations where id = $1 and enabled", [auto])).length, 0);

      // Built-in rules exist as rows and can be switched off.
      const on = await enabledBuiltins(tx);
      assert.ok(on.has("budget_burn") && on.has("collections"));
      await tx.q("update automations set enabled = false where builtin = 'collections'");
      assert.equal((await enabledBuiltins(tx)).has("collections"), false);

      // Connector steps save with their defaults; they need the app connected to run (tests/connectors.test.ts).
      assert.deepEqual(validateFlow({ trigger: { type: "invoice.sent", config: {} }, filters: [], actions: [{ type: "slack_message", config: {} }] }).actions[0].config, { channel: "client", message: "{{trigger}}: {{item}} · {{client}}" });
      assert.throws(() => validateFlow({ trigger: null, filters: [], actions: [] }), /trigger/);
    });
  });

  test("agency logos are checked by their bytes and size", async () => {
    await asA(async (tx) => {
      const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
      await setAgencyLogo(tx, png);
      assert.equal((await tx.one<{ logo_mime: string }>("select logo_mime from agencies where id = $1", [tx.agencyId]))!.logo_mime, "image/png");
      await setAgencyLogo(tx, Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'));
      assert.equal((await tx.one<{ logo_mime: string }>("select logo_mime from agencies where id = $1", [tx.agencyId]))!.logo_mime, "image/svg+xml");
      await assert.rejects(setAgencyLogo(tx, Buffer.from("MZ not an image")), /PNG, JPEG, WebP or SVG/);
      await assert.rejects(setAgencyLogo(tx, Buffer.concat([png, Buffer.alloc(600 * 1024)])), /512 KB/);
      await setAgencyLogo(tx, null);
      assert.equal((await tx.one<{ logo: Buffer | null }>("select logo from agencies where id = $1", [tx.agencyId]))!.logo, null);
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

describe("team time and workload", () => {
  test("managers see who did what per job and get a burnout alert for anyone overloaded", async () => {
    const today = todayIn("Africa/Johannesburg");
    await asA(async (tx) => {
      const company = await createCompany(tx, { name: `Workload Client ${run}` });
      const jobId = await readyJob(tx, company);
      const dev = (await tx.one<{ id: string }>(
        "insert into users (agency_id, email, name, password_hash, role, title, weekly_hours) values ($1, $2, 'Busy Dev', 'x', 'staff', 'Developer', 40) returning id",
        [A.agencyId, `dev-${run}@test.example`],
      ))!.id;
      // 12h a day for the last three weeks: well over a 40h week.
      for (let d = 1; d <= 21; d++) {
        await tx.q("insert into time_entries (agency_id, user_id, job_id, work_date, hours, notes) values ($1, $2, $3, $4, 12, $5)", [A.agencyId, dev, jobId, addDays(today, -d), d === 1 ? "Checkout build" : ""]);
      }

      const sheet = await teamTimesheet(tx, { from: addDays(today, -7), to: today, userId: dev });
      assert.equal(sheet.length, 1);
      assert.equal(sheet[0].job_id, jobId);
      assert.equal(sheet[0].hours, 84);
      assert.deepEqual(sheet[0].notes, ["Checkout build"]);

      const busy = (await teamWorkload(tx, today)).find((p) => p.id === dev)!;
      assert.equal(busy.status, "overloaded");
      assert.ok(busy.reasons.length > 0);

      await runAutomations(tx);
      await runAutomations(tx); // once a week, not on every run
      const alerts = await tx.q<{ user_id: string; href: string }>("select user_id, href from notifications where kind = 'workload' and title like '%Busy Dev%'");
      assert.deepEqual(alerts.map((a) => a.user_id), [A.userId]);
      assert.match(alerts[0].href, new RegExp(dev));
    });
  });
});

describe("booking design and web time", () => {
  test("a booking needs free time, job hours and scope; it becomes their task and frees up when declined", async () => {
    await asA(async (tx) => {
      const companyId = await createCompany(tx, { name: `Booking Client ${run}` });
      const jobId = await readyJob(tx, companyId, { template: "website" });
      await tx.q("update jobs set budget_hours = 10 where id = $1", [jobId]);
      const scope = (await tx.one<{ id: string }>("select id from scope_items where job_id = $1 order by created_at limit 1", [jobId]))!.id;
      const dev = (await tx.one<{ id: string }>(
        "insert into users (agency_id, email, name, password_hash, role, title, team, weekly_hours) values ($1, $2, 'Web Dev', 'x', 'staff', 'Developer', 'web', 40) returning id",
        [A.agencyId, `web-${run}@test.example`],
      ))!.id;
      const writer = (await tx.one<{ id: string }>(
        "insert into users (agency_id, email, name, password_hash, role, title, team) values ($1, $2, 'Copy Writer', 'x', 'staff', 'Copywriter', 'content') returning id",
        [A.agencyId, `copy-${run}@test.example`],
      ))!.id;
      let day = addDays(todayIn("Africa/Johannesburg"), 1);
      while (!isWeekday(day)) day = addDays(day, 1);
      const book = (o: Partial<Parameters<typeof createBooking>[1]>) =>
        createBooking(tx, { user_id: dev, job_id: jobId, scope_item_id: scope, work_date: day, start_time: "09:00", hours: 4, title: "Homepage build", ...o });

      const first = await book({});
      const task = await tx.one<{ assignee_id: string; estimate_hours: number; due_date: string; scope_item_id: string }>(
        "select t.assignee_id, t.estimate_hours::float, t.due_date::text, t.scope_item_id from bookings b join tasks t on t.id = b.task_id where b.id = $1",
        [first],
      );
      assert.deepEqual(task, { assignee_id: dev, estimate_hours: 4, due_date: day, scope_item_id: scope });
      assert.ok(await tx.one("select 1 from notifications where user_id = $1 and kind = 'booking'", [dev]));

      await assert.rejects(book({ start_time: "11:00", hours: 2 }), /Clashes with “Homepage build”/);
      await assert.rejects(book({ start_time: "13:00", hours: 6 }), /Only 4h free that day/);
      await assert.rejects(book({ start_time: "13:00", hours: 4, work_date: addDays(day, 1) }).then(() => book({ start_time: "13:00", hours: 3, work_date: addDays(day, 2) })), /Only 2h of the job's budget is left/);
      await assert.rejects(book({ user_id: writer }), /design or web team/);
      const otherJob = await readyJob(tx, companyId);
      const otherScope = (await tx.one<{ id: string }>("select id from scope_items where job_id = $1 limit 1", [otherJob]))!.id;
      await assert.rejects(book({ scope_item_id: otherScope }), /job's scope/);

      // Declining frees the time and removes the task; the booker is told why.
      await assert.rejects(declineBooking(tx, first, " "), /Say why/);
      const firstTask = (await tx.one<{ task_id: string }>("select task_id from bookings where id = $1", [first]))!.task_id;
      await declineBooking(tx, first, "On leave that day");
      assert.equal((await tx.one<{ task_id: string | null; status: string }>("select task_id, status from bookings where id = $1", [first]))!.status, "declined");
      assert.equal(await tx.one("select 1 from tasks where id = $1", [firstTask]), null);
      const again = await book({ start_time: "09:00", hours: 2 });
      await cancelBooking(tx, again);
      await assert.rejects(cancelBooking(tx, again), /no longer active/);
    });
  });
});

describe("team chat", () => {
  test("channels, private groups, DMs, mentions, kudos, reactions and unread counts", async () => {
    const [ama, ben] = await asA(async (tx) =>
      Promise.all(["Ama Mensah", "Ben Dlamini"].map(async (name) =>
        (await tx.one<{ id: string }>("insert into users (agency_id, email, name, password_hash, role, title) values ($1,$2,$3,'x','staff','Designer') returning id", [A.agencyId, `${name.split(" ")[0].toLowerCase()}-${run}@test.example`, name]))!.id,
      )),
    );
    const as = <T>(userId: string, name: string, fn: (tx: Tx) => Promise<T>) => withTenant({ agencyId: A.agencyId, userId, actorLabel: name }, fn);

    const { general, secret } = await asA(async (tx) => {
      await ensureDefaults(tx);
      const general = (await tx.one<{ id: string }>("select id from chat_channels where name = 'general'"))!.id;
      assert.equal((await tx.one<{ n: number }>("select count(*)::int as n from chat_members where channel_id = $1 and user_id = any($2)", [general, [ama, ben]]))!.n, 2);
      const secret = await createChannel(tx, { name: "Pitch Team!", category: "project", private: true, members: [ama] });
      assert.equal((await tx.one<{ name: string }>("select name from chat_channels where id = $1", [secret]))!.name, "pitch-team");
      await assert.rejects(createChannel(tx, { name: "pitch team", category: "project", private: false }), /already exists/);
      return { general, secret };
    });

    // Ben isn't in the private group: he can't read it or post to it.
    await as(ben, "Ben Dlamini", (tx) => assert.rejects(messages(tx, secret, ben).then(() => channelFor(tx, secret, ben)), /private/));
    await as(ben, "Ben Dlamini", (tx) => assert.rejects(sendMessage(tx, secret, "let me in"), /private/));

    await as(ama, "Ama Mensah", async (tx) => {
      await sendMessage(tx, general, "Morning team! @Ben can you check the **launch** deck?");
      await assert.rejects(sendMessage(tx, general, "Thanks all", "kudos"), /@mention/);
      await sendMessage(tx, general, "Huge thanks @Ben Dlamini for the late night 🙌", "kudos");
    });
    await as(ben, "Ben Dlamini", async (tx) => {
      const n = await tx.q<{ kind: string; title: string }>("select kind, title from notifications where user_id = $1 order by created_at", [ben]);
      assert.deepEqual(n.map((x) => x.kind).sort(), ["chat", "kudos"]);
      assert.equal(n.find((x) => x.kind === "kudos")!.title, "Ama Mensah gave you kudos 🎉");
      assert.equal(await unreadTotal(tx, ben), 2);
      const list = await messages(tx, general, ben);
      const last = list[list.length - 1];
      await toggleReaction(tx, last.id, "🎉");
      await assert.rejects(editMessage(tx, last.id, "changed"), /your own/);
      await markRead(tx, general, ben, last.seq);
      assert.equal(await unreadTotal(tx, ben), 0);
      assert.deepEqual((await messages(tx, general, ben, { afterSeq: last.seq, since: new Date(Date.now() - 60_000).toISOString() })).find((m) => m.id === last.id)?.reactions, [{ emoji: "🎉", count: 1, mine: true, names: ["Ben Dlamini"] }]);
      await assert.rejects(leaveChannel(tx, general), /stays in #general/);
      // The same people always land in the same direct conversation.
      const dm = await openDirect(tx, [ama]);
      assert.equal(await openDirect(tx, [ama]), dm);
      await sendMessage(tx, dm, "Coffee?");
    });
    await as(ama, "Ama Mensah", async (tx) => {
      assert.ok(await tx.one("select 1 from notifications where user_id = $1 and title = 'Ben sent you a message'", [ama]));
      const mine = (await messages(tx, general, ama)).find((m) => m.body.startsWith("Morning"))!;
      await editMessage(tx, mine.id, "Morning team! @Ben the deck is in Drive");
      await deleteMessage(tx, mine.id, false);
      const gone = (await messages(tx, general, ama)).find((m) => m.id === mine.id)!;
      assert.deepEqual([gone.deleted, gone.body], [true, ""]);
    });
  });
});
