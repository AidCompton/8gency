import type { Tx } from "../db";
import { addDays, isWeekday, todayIn } from "../domain/dates";
import { addContact, createCompany } from "./agency";
import { agencySettings, rateFor, UserError } from "./core";
import { createInvoice, readyToBill, sendInvoice } from "./billing";
import { addTask, createJob, lockScope, setJobStatus } from "./jobs";
import { createRetainer } from "./retainers";
import { addScopeItem } from "./scope";

// A made-up agency for a new owner to look around before importing their own
// data: three clients, a small team, a few jobs with real-looking leaks (a job
// over budget, work done and not invoiced, out-of-scope work given away, an
// overdue invoice, a retainer over its hours), so Home and Pulse have something
// to show and the one-click fixes have something to fix. Everything is marked
// as sample and one click removes all of it. No email address is real, and
// nothing reaches an outside inbox.

const SAMPLE_USERS = [
  { name: "Ayanda Dlamini (sample)", title: "Designer", team: "design", cost: 28_000 },
  { name: "Ben Carter (sample)", title: "Developer", team: "web", cost: 42_000 },
  { name: "Chloe Naidoo (sample)", title: "Account Manager", team: "account", cost: 36_000 },
];

export const isSampleLoaded = async (tx: Tx) => Boolean(await tx.one("select 1 from companies where is_sample limit 1"));

/** Small deterministic generator so the sample looks the same every time. */
function lcg(seed: number) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

export async function loadSample(tx: Tx) {
  if (await isSampleLoaded(tx)) throw new UserError("The sample agency is already loaded.");
  const settings = await agencySettings(tx);
  const today = todayIn(settings.timezone);
  const rand = lcg(7);
  const tag = tx.agencyId.slice(0, 8);

  // The team: people who can't sign in, so nobody gets an email or a login.
  const people: { id: string; title: string; cost: number }[] = [];
  for (const [n, u] of SAMPLE_USERS.entries()) {
    const row = await tx.one<{ id: string }>(
      `insert into users (agency_id, email, name, password_hash, role, title, team, cost_rate_cents, is_sample)
       values ($1,$2,$3,$4,'staff',$5,$6,$7,true) returning id`,
      [tx.agencyId, `sample-${tag}-${n}@sample.invalid`, u.name, `$2a$10$${"x".repeat(53)}`, u.title, u.team, u.cost],
    );
    people.push({ id: row!.id, title: u.title, cost: u.cost });
  }

  const client = async (name: string, contact: string) => {
    const id = await createCompany(tx, { name, payment_terms_days: 30, billing_email: `billing@${tag}.sample.invalid` });
    await tx.q("update companies set is_sample = true, status = 'active' where id = $1", [id]);
    await addContact(tx, { company_id: id, name: contact, email: `approver@${tag}.sample.invalid`, role: "approver" });
    await addContact(tx, { company_id: id, name: `${contact.split(" ")[0]} (accounts)`, email: `accounts@${tag}.sample.invalid`, role: "billing" });
    return id;
  };
  const bluebird = await client("Bluebird Coffee (sample)", "Nomsa Khumalo");
  const summit = await client("Summit Outdoors (sample)", "Pieter Botha");
  const fern = await client("Fern & Co (sample)", "Lerato Mokoena");

  /** A live job with an approved scope, the way a well-run agency starts one. */
  const liveJob = async (companyId: string, name: string, fee: number, budget: number, template: string, scope: { name: string; unit: "deliverable" | "hours"; quantity: number; rounds: number }[]) => {
    const id = await createJob(tx, { company_id: companyId, name, template_key: template, fee_cents: fee, budget_hours: budget, owner_id: tx.userId });
    await tx.q("update briefs set objective='Grow sales this quarter', audience='Young professionals', key_message='Simple and honest', deliverables='As scoped', must_haves='Logo', budget='As quoted', success_measure='Sales' where job_id=$1", [id]);
    const approver = await tx.one<{ id: string }>("select id from contacts where company_id = $1 and role = 'approver' limit 1", [companyId]);
    await tx.q("update briefs set approver_contact_id = $2 where job_id = $1", [id, approver?.id ?? null]);
    for (const s of scope) await addScopeItem(tx, { company_id: companyId, job_id: id, name: s.name, unit: s.unit, quantity: s.quantity, rounds_allowed: s.rounds });
    await lockScope(tx, id);
    await setJobStatus(tx, id, "in_progress");
    return id;
  };

  /** Spread hours over the last `days` weekdays, split across the team. */
  const work = async (jobId: string, companyId: string, total: number, days: number, who = people) => {
    const dates: string[] = [];
    for (let d = days; d >= 1; d--) if (isWeekday(addDays(today, -d))) dates.push(addDays(today, -d));
    const per = total / dates.length;
    for (const date of dates) {
      const p = who[Math.floor(rand() * who.length)];
      const hours = Math.max(0.5, Math.round(per * (0.7 + rand() * 0.6) * 4) / 4);
      await tx.q(
        `insert into time_entries (agency_id, user_id, job_id, work_date, hours, category, rate_cents, cost_cents, source)
         values ($1,$2,$3,$4,$5,'billable',$6,$7,'manual')`,
        [tx.agencyId, p.id, jobId, date, hours, await rateFor(tx, p.title, companyId, date), p.cost],
      );
    }
  };

  // Bluebird: a campaign over its hours budget, a deposit billed and overdue, and a milestone done but not invoiced.
  const spring = await liveJob(bluebird, "Spring campaign", 120_000_00, 160, "campaign", [
    { name: "Campaign concept and key visual", unit: "deliverable", quantity: 1, rounds: 2 },
    { name: "Social statics", unit: "deliverable", quantity: 6, rounds: 2 },
    { name: "Campaign video (30s)", unit: "deliverable", quantity: 1, rounds: 2 },
  ]);
  await work(spring, bluebird, 188, 50);
  const deposit = await readyToBill(tx, bluebird);
  const invId = await createInvoice(tx, bluebird, deposit.filter((i) => i.source_type !== "time").map((i) => i.key));
  await sendInvoice(tx, invId);
  await tx.q("update invoices set issue_date = $2, due_date = $3, sent_at = now() - interval '30 days' where id = $1", [invId, addDays(today, -34), addDays(today, -12)]);
  await tx.q("update milestones set status = 'complete', completed_at = now() - interval '20 days' where job_id = $1 and status <> 'complete' and trigger = 'completion'", [spring]);

  // Summit: a website with scope, plus extra work the client was never charged for.
  const web = await liveJob(summit, "Website rebuild", 240_000_00, 300, "website", [
    { name: "Sitemap and wireframes", unit: "deliverable", quantity: 1, rounds: 2 },
    { name: "Page designs", unit: "deliverable", quantity: 6, rounds: 2 },
    { name: "Build and CMS setup", unit: "hours", quantity: 80, rounds: 0 },
  ]);
  await work(web, summit, 150, 45);
  const extra = await addTask(tx, { job_id: web, title: "Extra landing page for the winter promo", assignee_id: people[0].id, out_of_scope: true, estimate_hours: 10, due_date: addDays(today, 3) });
  for (const [i, d] of [-6, -5, -4].entries()) {
    await tx.q("insert into time_entries (agency_id, user_id, job_id, task_id, work_date, hours, category, rate_cents, cost_cents, source) values ($1,$2,$3,$4,$5,$6,'billable',$7,$8,'manual')", [
      tx.agencyId, people[0].id, web, extra, addDays(today, d - 3 + i), 4, await rateFor(tx, people[0].title, summit, today), people[0].cost,
    ]);
  }
  // A second job with no scope yet: the "needs scope" nudge.
  const catalogue = await createJob(tx, { company_id: summit, name: "Gear catalogue", template_key: "blank", budget_hours: 0, billing_model: "tm", owner_id: tx.userId });
  await tx.q("update jobs set status = 'in_progress' where id = $1", [catalogue]);
  await work(catalogue, summit, 22, 20, [people[0]]);

  // Fern: a monthly retainer that ended over its hours.
  const retainerId = await createRetainer(tx, {
    company_id: fern, name: "Fern & Co social", fee_cents: 36_000_00, hours_per_period: 40, start_date: addDays(today, -45), rollover: "none", rollover_cap_hours: 0,
    billing_timing: "advance", price_increase_pct: 0, job_template_key: "social_month", job_owner_id: tx.userId, scope: [],
  });
  const first = (await tx.one<{ starts_on: string; ends_on: string }>("select starts_on::text, ends_on::text from retainer_periods where retainer_id = $1 order by starts_on limit 1", [retainerId]))!;
  const rjob = (await tx.one<{ id: string }>("select id from jobs where retainer_id = $1 order by start_date limit 1", [retainerId]))!;
  await tx.q("update jobs set status = 'in_progress' where id = $1", [rjob.id]);
  // 2.5 hours on every weekday of the month: about 52 hours against 40 agreed.
  for (let date = first.starts_on, i = 0; date <= first.ends_on; date = addDays(date, 1)) {
    if (!isWeekday(date)) continue;
    const p = people[i++ % 3];
    await tx.q("insert into time_entries (agency_id, user_id, job_id, work_date, hours, category, rate_cents, cost_cents, source) values ($1,$2,$3,$4,2.5,'billable',$5,$6,'manual')", [
      tx.agencyId, p.id, rjob.id, date, await rateFor(tx, p.title, fern, date), p.cost,
    ]);
  }

  await tx.q("update agencies set sample_loaded_at = now() where id = $1", [tx.agencyId]);
  await tx.audit("sample.loaded", "agency", tx.agencyId);
  return { firstJobId: spring };
}

/** Remove the sample agency and nothing else. Real clients, people and data are never touched. */
export async function clearSample(tx: Tx) {
  const companies = (await tx.q<{ id: string }>("select id from companies where is_sample")).map((c) => c.id);
  const users = (await tx.q<{ id: string }>("select id from users where is_sample")).map((u) => u.id);
  if (companies.length || users.length) {
    const jobs = (await tx.q<{ id: string }>("select id from jobs where company_id = any($1)", [companies])).map((j) => j.id);
    // Money and time first, then the work, then the clients and people.
    await tx.q("delete from time_entries where job_id = any($1) or user_id = any($2)", [jobs, users]);
    await tx.q("delete from write_offs where company_id = any($1)", [companies]);
    await tx.q("delete from invoices where company_id = any($1)", [companies]);
    await tx.q("delete from costs where job_id = any($1)", [jobs]);
    await tx.q("delete from change_requests where company_id = any($1)", [companies]);
    await tx.q("delete from jobs where company_id = any($1)", [companies]);
    await tx.q("delete from retainers where company_id = any($1)", [companies]);
    await tx.q("delete from scope_items where company_id = any($1)", [companies]);
    await tx.q("delete from client_requests where company_id = any($1)", [companies]);
    await tx.q("delete from notifications where user_id = any($1)", [users]);
    await tx.q("delete from companies where id = any($1)", [companies]);
    await tx.q("update tasks set assignee_id = null where assignee_id = any($1)", [users]);
    await tx.q("delete from users where id = any($1)", [users]);
  }
  await tx.q("update agencies set sample_loaded_at = null where id = $1", [tx.agencyId]);
  await tx.audit("sample.cleared", "agency", tx.agencyId, undefined, { clients: companies.length, people: users.length });
}
