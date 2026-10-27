// Demo data: a fictional 10-person Johannesburg agency with 90 days of history,
// shaped so the Agency Health Scan finds real money on day one.
//   npm run db:seed
// Log in as owner@sundaystudio.example / demo1234 (every demo user shares the password).
import "./env";
import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import { closePools, withAdminTx, withTenant, type Tx } from "../src/lib/db";
import { addDays, isWeekday, startOfMonth, addMonths, todayIn } from "../src/lib/domain/dates";
import { addContact, createAgencyWithOwner, createCompany, setAgencyLogo } from "../src/lib/services/agency";
import { createInvoice, readyToBill, recordPayment, sendInvoice } from "../src/lib/services/billing";
import { addTask, closeJob, createJob, lockScope, setJobStatus } from "../src/lib/services/jobs";
import { createRetainer, reconcilePeriod } from "../src/lib/services/retainers";
import { createDeliverable, uploadVersion, sendToClient, clientDecision, internalDecision } from "../src/lib/services/review";
import { absorbChangeRequest, createChangeRequest, sendChangeRequest, submitClientRequest } from "../src/lib/services/scope";
import { logTime } from "../src/lib/services/time";
import { runAutomations } from "../src/lib/services/automations";
import { createBooking } from "../src/lib/services/bookings";
import { seedChat } from "./seed-chat";

const PASSWORD = "demo1234";
const TZ = "Africa/Johannesburg";
const today = todayIn(TZ);

let seed = 42;
function rand() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
function pickOne<T>(xs: T[]): T {
  return xs[Math.floor(rand() * xs.length)];
}

function svg(title: string, color: string, sub: string) {
  return new File(
    [
      `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
  <rect width="1200" height="800" fill="${color}"/>
  <circle cx="960" cy="180" r="220" fill="#ffffff" opacity="0.12"/>
  <text x="80" y="420" font-family="Helvetica, Arial, sans-serif" font-size="84" font-weight="700" fill="#ffffff">${title}</text>
  <text x="80" y="500" font-family="Helvetica, Arial, sans-serif" font-size="36" fill="#ffffff" opacity="0.85">${sub}</text>
</svg>`,
    ],
    `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.svg`,
    { type: "image/svg+xml" },
  );
}

async function fillBrief(tx: Tx, jobId: string, approverId: string, b: Partial<Record<string, string>>) {
  await tx.q(
    `update briefs set objective=$2, audience=$3, key_message=$4, deliverables=$5, must_haves=$6, budget=$7, approver_contact_id=$8, success_measure=$9 where job_id=$1`,
    [jobId, b.objective ?? "", b.audience ?? "", b.key_message ?? "", b.deliverables ?? "", b.must_haves ?? "", b.budget ?? "", approverId, b.success_measure ?? ""],
  );
}

async function main() {
  const hash = await bcrypt.hash(PASSWORD, 10);
  const existing = await withAdminTx(async (c) => (await c.query("select 1 from users where email = 'owner@sundaystudio.example'")).rowCount);
  if (existing) {
    console.log("Demo agency already seeded. Run `npm run db:reset` to start over.");
    await closePools();
    return;
  }
  const { agencyId, userId: ownerId } = await withAdminTx((c) =>
    createAgencyWithOwner(c, { agencyName: "Sunday Studio", agencyType: "full_service", ownerName: "Lerato Dlamini", email: "owner@sundaystudio.example", passwordHash: hash }),
  );
  const ctx = (label: string, userId: string | null = ownerId) => ({ agencyId, userId, actorLabel: label });

  const people = await withTenant(ctx("Lerato Dlamini"), async (tx) => {
    await setAgencyLogo(tx, readFileSync("scripts/demo-logo.svg"));
    await tx.q(
      `update entities set legal_name = 'Sunday Studio (Pty) Ltd', tax_number = '4000000000', registration_number = '2019/000000/07',
              address = '12 Example Street, Braamfontein, Johannesburg, 2001', bank_details = 'Example Bank · Acc 000000000 · Branch 000000' where agency_id = $1`,
      [agencyId],
    );
    const team: [string, string, string, string, number, number, string][] = [
      ["Pieter van Wyk", "ops@sundaystudio.example", "ops", "Project Manager", 380_00, 0.5, "management"],
      ["Ayesha Patel", "finance@sundaystudio.example", "finance", "Finance Manager", 400_00, 0, "finance"],
      ["Sipho Ndlovu", "sipho@sundaystudio.example", "account", "Account Manager", 420_00, 0.55, "account"],
      ["Jess Naidoo", "jess@sundaystudio.example", "pm", "Project Manager", 380_00, 0.6, "management"],
      ["Kabelo Mahlangu", "kabelo@sundaystudio.example", "staff", "Senior Designer", 420_00, 0.75, "design"],
      ["Mia Botha", "mia@sundaystudio.example", "staff", "Designer", 300_00, 0.75, "design"],
      ["Ruan Smit", "ruan@sundaystudio.example", "staff", "Copywriter", 340_00, 0.75, "content"],
      ["Zanele Khumalo", "zanele@sundaystudio.example", "staff", "Developer", 480_00, 0.75, "web"],
      ["Tom Fischer", "tom@sundaystudio.example", "staff", "Social Media Manager", 280_00, 0.75, "social"],
    ];
    const ids: Record<string, string> = { owner: ownerId };
    await tx.q("update users set team = 'management' where id = $1", [ownerId]);
    for (const [name, email, role, title, cost, target, unit] of team) {
      const r = await tx.one<{ id: string }>(
        `insert into users (agency_id, email, name, password_hash, role, title, cost_rate_cents, target_utilisation, team) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [agencyId, email, name, hash, role, title, cost, target, unit],
      );
      ids[name.split(" ")[0].toLowerCase()] = r!.id;
    }
    return ids;
  });

  const start90 = addDays(today, -90);
  const retainerStart = startOfMonth(addMonths(today, -3));

  // ── Clients ──
  const c = await withTenant(ctx("Lerato Dlamini"), async (tx) => {
    const bcb = await createCompany(tx, { name: "Blue Crane Brewing", code: "BCB", po_required: true, payment_terms_days: 30, account_manager_id: people.sipho });
    const koc = await createCompany(tx, { name: "Karoo Outdoor Co", code: "KOC", payment_terms_days: 30, account_manager_id: people.sipho });
    const vela = await createCompany(tx, { name: "Vela Health", code: "VELA", payment_terms_days: 14, account_manager_id: people.sipho });
    const mmm = await createCompany(tx, { name: "Mzansi Mobile Money", code: "MMM", payment_terms_days: 30, account_manager_id: people.pieter });
    const ff = await createCompany(tx, { name: "Fynbos Foods", code: "FF", payment_terms_days: 30, account_manager_id: people.sipho });
    for (const id of [bcb, koc, vela, mmm]) await tx.q("update companies set status = 'active', created_at = $2 where id = $1", [id, `${addDays(start90, -60)}T09:00:00Z`]);
    await tx.q("update companies set satisfaction = 3 where id = $1", [bcb]);
    await tx.q("update companies set satisfaction = 4 where id = $1", [vela]);
    await tx.q("update companies set satisfaction = 5 where id = $1", [mmm]);
    await tx.q("update companies set created_at = $2 where id = $1", [ff, `${addDays(today, -31)}T09:00:00Z`]);
    await tx.q("update onboarding_items set done_at = now(), done_by = 'Sipho Ndlovu' where company_id = any($1)", [[bcb, koc, vela, mmm]]);
    await tx.q("update onboarding_items set done_at = now(), done_by = 'Sipho Ndlovu' where company_id = $1 and category in ('billing','kickoff')", [ff]);

    const contact = (company_id: string, name: string, email: string, phone: string, role: "approver" | "commenter" | "billing") =>
      addContact(tx, { company_id, name, email, phone, role });
    return {
      bcb, koc, vela, mmm, ff,
      bcbApprover: await contact(bcb, "Naledi Mokoena", "naledi@bluecrane.example", "+27 82 555 0101", "approver"),
      bcbBilling: await contact(bcb, "Accounts Payable", "ap@bluecrane.example", "", "billing"),
      bcbCommenter: await contact(bcb, "Dan Pretorius", "dan@bluecrane.example", "+27 82 555 0102", "commenter"),
      kocApprover: await contact(koc, "Megan Steyn", "megan@karoooutdoor.example", "+27 83 555 0201", "approver"),
      kocBilling: await contact(koc, "Johan Steyn", "finance@karoooutdoor.example", "", "billing"),
      velaApprover: await contact(vela, "Dr Priya Govender", "priya@velahealth.example", "+27 84 555 0301", "approver"),
      velaBilling: await contact(vela, "Vela Finance", "finance@velahealth.example", "", "billing"),
      mmmApprover: await contact(mmm, "Andile Zulu", "andile@mzansimm.example", "+27 72 555 0401", "approver"),
      mmmBilling: await contact(mmm, "MMM Payables", "payables@mzansimm.example", "", "billing"),
      ffContact: await contact(ff, "Carla Jacobs", "carla@fynbosfoods.example", "+27 79 555 0501", "commenter"),
    };
  });

  // ── Retainer (overserviced) ──
  const retainerId = await withTenant(ctx("Sipho Ndlovu", people.sipho), (tx) =>
    createRetainer(tx, {
      company_id: c.bcb,
      name: "Blue Crane social",
      fee_cents: 48_000_00,
      hours_per_period: 40,
      start_date: retainerStart,
      rollover: "capped",
      rollover_cap_hours: 6,
      billing_timing: "advance",
      price_increase_pct: 6,
      job_template_key: "social_month",
      job_owner_id: people.tom,
      scope: [
        { name: "Social posts", unit: "deliverable", quantity: 12, rounds: 1 },
        { name: "Community management", unit: "hours", quantity: 10, rounds: 0 },
      ],
    }),
  );

  const mmmRetainerId = await withTenant(ctx("Pieter van Wyk", people.pieter), (tx) =>
    createRetainer(tx, {
      company_id: c.mmm,
      name: "Always-on performance content",
      fee_cents: 205_000_00,
      hours_per_period: 195,
      start_date: retainerStart,
      rollover: "none",
      rollover_cap_hours: 0,
      billing_timing: "arrears",
      price_increase_pct: 6,
      job_template_key: "social_month",
      job_owner_id: people.tom,
      scope: [
        { name: "Ad creative variants", unit: "deliverable", quantity: 40, rounds: 1 },
        { name: "Optimisation and reporting", unit: "hours", quantity: 60, rounds: 0 },
      ],
    }),
  );

  // ── Project jobs ──
  const jobs = await withTenant(ctx("Jess Naidoo", people.jess), async (tx) => {
    const koc = await createJob(tx, {
      company_id: c.koc, name: "Karoo Outdoor website", template_key: "website", fee_cents: 185_000_00, owner_id: people.jess, account_manager_id: people.sipho,
      start_date: addDays(today, -70), due_date: addDays(today, 12), assignee_id: people.zanele, budget_hours: 240,
    });
    const vela = await createJob(tx, {
      company_id: c.vela, name: "Vela 'Care that comes to you' launch", template_key: "campaign", fee_cents: 120_000_00, owner_id: people.jess, account_manager_id: people.sipho,
      start_date: addDays(today, -45), due_date: addDays(today, 5), assignee_id: people.kabelo, budget_hours: 190,
    });
    const mmm = await createJob(tx, {
      company_id: c.mmm, name: "MMM spring acquisition flight", template_key: "media_flight", owner_id: people.pieter, account_manager_id: people.pieter,
      start_date: addDays(today, -40), due_date: addDays(today, 10), assignee_id: people.tom, budget_hours: 120,
    });
    const ff = await createJob(tx, {
      company_id: c.ff, name: "Fynbos Foods packaging refresh", template_key: "design", fee_cents: 38_000_00, owner_id: people.jess, account_manager_id: people.sipho,
      start_date: addDays(today, 2), assignee_id: people.mia,
    });
    const pitch = await createJob(tx, { company_id: c.mmm, name: "Internal: new-business pitch prep", template_key: "blank", billing_model: "internal", owner_id: ownerId });
    const brochure = await createJob(tx, {
      company_id: c.koc, name: "Karoo Outdoor winter brochure", template_key: "design", fee_cents: 48_000_00, budget_hours: 160, owner_id: people.jess, account_manager_id: people.sipho,
      start_date: addDays(today, -88), due_date: addDays(today, -48), assignee_id: people.mia,
    });
    const guidelines = await createJob(tx, {
      company_id: c.vela, name: "Vela brand guidelines", template_key: "design", fee_cents: 96_000_00, budget_hours: 260, owner_id: people.jess, account_manager_id: people.sipho,
      start_date: addDays(today, -88), due_date: addDays(today, 8), assignee_id: people.kabelo,
    });
    await tx.q("update jobs set status = 'in_progress' where id = $1", [pitch]);

    await fillBrief(tx, koc, c.kocApprover, {
      objective: "Grow online bookings for guided hikes by 30% before December holidays", audience: "Gauteng families and couples, 28-50, weekend adventurers",
      key_message: "The Karoo is closer than you think", deliverables: "Sitemap, 6 page designs, CMS build", must_haves: "Booking widget, POPIA consent on forms",
      budget: "R185 000", success_measure: "Online bookings per month",
    });
    await fillBrief(tx, vela, c.velaApprover, {
      objective: "Launch home-visit nursing in Johannesburg north and get 400 sign-ups in 6 weeks", audience: "Adult children caring for elderly parents, 35-55",
      key_message: "Professional care, at home, booked in minutes", deliverables: "Concept, key visual, 6 social statics, 30s video", must_haves: "HPCSA-compliant claims, disclaimer line",
      budget: "R120 000 fees", success_measure: "Sign-ups via landing page",
    });
    await fillBrief(tx, mmm, c.mmmApprover, {
      objective: "Acquire 5 000 new wallet users at under R60 cost per acquisition", audience: "Informal traders and gig workers, 20-40, Android",
      key_message: "Get paid instantly, no bank queue", deliverables: "Meta and Google campaigns, 8 ad variants", must_haves: "FSCA disclaimer on every ad",
      budget: "R400k media + fees on time", success_measure: "CPA and activated wallets",
    });
    await tx.q("update briefs set objective = 'New packaging', audience = '' where job_id = $1", [ff]);

    await fillBrief(tx, brochure, c.kocApprover, { objective: "Drive winter bookings from walk-in visitors at partner lodges", audience: "Lodge guests, 35-60", key_message: "Winter is the Karoo's best season", deliverables: "16-page A5 brochure", must_haves: "Price list, map, booking QR code", budget: "R48 000", success_measure: "QR scans and bookings" });
    await fillBrief(tx, guidelines, c.velaApprover, { objective: "Give Vela's in-house team and suppliers one consistent brand system", audience: "Vela marketing team and suppliers", key_message: "Warm, professional, clinical-grade", deliverables: "Brand guidelines PDF, templates", must_haves: "Accessibility colour contrast", budget: "R96 000", success_measure: "Supplier work approved first time" });
    for (const id of [koc, vela, mmm, brochure, guidelines]) {
      await lockScope(tx, id);
      await setJobStatus(tx, id, "in_progress");
    }
    // Spread template tasks across the team.
    const assign = async (jobId: string, who: string[]) => {
      const ts = await tx.q<{ id: string }>("select id from tasks where job_id = $1 order by due_date", [jobId]);
      for (const [i, t] of ts.entries()) await tx.q("update tasks set assignee_id = $2 where id = $1", [t.id, who[i % who.length]]);
    };
    await assign(koc, [people.kabelo, people.mia, people.zanele, people.zanele, people.zanele, people.jess]);
    await assign(vela, [people.ruan, people.kabelo, people.kabelo, people.mia, people.ruan, people.jess]);
    await assign(mmm, [people.tom, people.tom, people.mia, people.tom, people.tom]);
    // Out-of-scope work that crept in.
    await addTask(tx, { job_id: koc, title: "Extra landing page for the Sutherland stargazing package", assignee_id: people.zanele, out_of_scope: true, estimate_hours: 10, due_date: addDays(today, 6) });
    return { koc, vela, mmm, ff, pitch, brochure, guidelines };
  });

  // Mark early tasks done so progress is realistic.
  await withTenant(ctx("Jess Naidoo", people.jess), async (tx) => {
    await tx.q("update tasks set status = 'done', completed_at = now() where job_id = any($1) and due_date < $2", [[jobs.koc, jobs.vela, jobs.mmm], today]);
    await tx.q("update tasks set status = 'done' where job_id in (select id from jobs where retainer_id = $1 and due_date < $2)", [retainerId, today]);
    await tx.q("update jobs set scope_locked_at = now(), status = case when due_date < $2 then 'complete' else 'in_progress' end where retainer_id = any($1)", [[retainerId, mmmRetainerId], today]);
    await tx.q("update tasks set status = 'done' where job_id in (select id from jobs where retainer_id = $1 and due_date < $2)", [mmmRetainerId, today]);
    await tx.q("update tasks set status = 'blocked', blocked_reason = 'Waiting on product photography from client' where job_id = $1 and title like 'Front-end%'", [jobs.koc]);
  });

  // ── 90 days of time ──
  const retainerJobs = await withTenant(ctx("seed"), (tx) =>
    tx.q<{ id: string; start_date: string; due_date: string }>("select id, start_date, due_date from jobs where retainer_id = $1 order by start_date", [retainerId]),
  );
  const tasksFor = (jobId: string) => withTenant(ctx("seed"), (tx) => tx.q<{ id: string; title: string; assignee_id: string | null; out_of_scope: boolean }>("select id, title, assignee_id, out_of_scope from tasks where job_id = $1", [jobId]));
  const jobTasks: Record<string, { id: string; title: string; assignee_id: string | null; out_of_scope: boolean }[]> = {};
  for (const id of [jobs.koc, jobs.vela, jobs.mmm, jobs.pitch, jobs.brochure, jobs.guidelines, ...retainerJobs.map((j) => j.id)]) jobTasks[id] = await tasksFor(id);

  type Plan = { user: string; job: (d: string) => string | null; hours: () => number; category?: "billable" | "internal" | "new_business" | "admin" };
  const retainerJobOn = (d: string) => retainerJobs.find((j) => j.start_date <= d && j.due_date >= d)?.id ?? null;
  const mmmRetainerJobs = await withTenant(ctx("seed"), (tx) =>
    tx.q<{ id: string; start_date: string; due_date: string }>("select id, start_date, due_date from jobs where retainer_id = $1 order by start_date", [mmmRetainerId]),
  );
  for (const j of mmmRetainerJobs) jobTasks[j.id] = await tasksFor(j.id);
  const mmmJobOn = (d: string) => (rand() < 0.85 ? mmmRetainerJobs.find((j) => j.start_date <= d && j.due_date >= d)?.id ?? null : null);
  const plans: Plan[] = [
    { user: people.tom, job: mmmJobOn, hours: () => 1.5 + rand() },
    { user: people.mia, job: mmmJobOn, hours: () => 1.5 + rand() },
    { user: people.ruan, job: mmmJobOn, hours: () => 1.5 + rand() },
    { user: people.kabelo, job: mmmJobOn, hours: () => 1 + rand() },
    { user: people.zanele, job: mmmJobOn, hours: () => 1 + rand() },
    // Retainer runs ~30% over its 40h: Tom, Mia and Ruan all chip in.
    { user: people.tom, job: retainerJobOn, hours: () => 1.5 + rand() * 1.5 },
    { user: people.mia, job: (d) => (rand() < 0.35 ? retainerJobOn(d) : null), hours: () => 1 + rand() },
    { user: people.ruan, job: (d) => (rand() < 0.25 ? retainerJobOn(d) : null), hours: () => 0.5 + rand() },
    { user: people.zanele, job: (d) => (d >= addDays(today, -70) ? jobs.koc : null), hours: () => 3 + rand() * 1.5 },
    { user: people.kabelo, job: (d) => (d >= addDays(today, -70) && rand() < 0.3 ? jobs.koc : null), hours: () => 2 + rand() },
    { user: people.kabelo, job: (d) => (d >= addDays(today, -45) ? jobs.vela : null), hours: () => 2 + rand() * 2 },
    { user: people.ruan, job: (d) => (d >= addDays(today, -45) && rand() < 0.6 ? jobs.vela : null), hours: () => 1.5 + rand() * 2 },
    { user: people.mia, job: (d) => (d >= addDays(today, -45) && rand() < 0.5 ? jobs.vela : null), hours: () => 1.5 + rand() * 1.5 },
    { user: people.tom, job: (d) => (d >= addDays(today, -40) && rand() < 0.7 ? jobs.mmm : null), hours: () => 1.5 + rand() * 2 },
    { user: people.mia, job: (d) => (d >= addDays(today, -40) && rand() < 0.3 ? jobs.mmm : null), hours: () => 1 + rand() * 1.5 },
    { user: people.jess, job: () => pickOne([jobs.koc, jobs.vela, jobs.mmm, null, null]), hours: () => 0.5 + rand() },
    { user: people.sipho, job: (d) => pickOne([jobs.koc, jobs.vela, retainerJobOn(d)]), hours: () => 0.5 + rand() * 1.5 },
    { user: people.sipho, job: () => (rand() < 0.3 ? jobs.pitch : null), hours: () => 1 + rand() * 2, category: "new_business" },
    { user: ownerId, job: () => (rand() < 0.4 ? jobs.pitch : null), hours: () => 1 + rand() * 2, category: "new_business" },
    { user: people.pieter, job: (d) => (d >= addDays(today, -40) && rand() < 0.5 ? jobs.mmm : rand() < 0.4 ? jobs.pitch : null), hours: () => 1 + rand() * 2 },
    { user: ownerId, job: (d) => (rand() < 0.5 ? pickOne([d >= addDays(today, -70) ? jobs.koc : null, d >= addDays(today, -45) ? jobs.vela : null]) : null), hours: () => 0.5 + rand() },
    { user: people.ruan, job: (d) => (d >= addDays(today, -86) && d < addDays(today, -50) ? jobs.brochure : null), hours: () => 2.5 + rand() * 1.5 },
    { user: people.mia, job: (d) => (d >= addDays(today, -86) && d < addDays(today, -50) ? jobs.brochure : null), hours: () => 2.5 + rand() * 1.5 },
    { user: people.kabelo, job: (d) => (d >= addDays(today, -88) && d < addDays(today, -46) ? jobs.guidelines : null), hours: () => 3 + rand() * 2 },
    { user: people.ruan, job: (d) => (d >= addDays(today, -40) && rand() < 0.5 ? jobs.guidelines : null), hours: () => 1.5 + rand() },
    { user: people.mia, job: (d) => (d >= addDays(today, -40) && rand() < 0.5 ? jobs.guidelines : null), hours: () => 1.5 + rand() },
  ];
  let entries = 0;
  for (let d = start90; d < today; d = addDays(d, 1)) {
    if (!isWeekday(d)) continue;
    for (const p of plans) {
      const jobId = p.job(d);
      if (!jobId) continue;
      const candidates = (jobTasks[jobId] ?? []).filter((t) => !t.out_of_scope && (t.assignee_id === p.user || !t.assignee_id));
      const task = candidates.length ? pickOne(candidates) : null;
      await withTenant(ctx("seed", p.user), (tx) =>
        logTime(tx, p.user, {
          job_id: jobId,
          task_id: task?.id ?? null,
          work_date: d,
          hours: Math.round(p.hours() * 4) / 4,
          category: p.category ?? (jobId === jobs.pitch ? "internal" : "billable"),
          source: "import",
        }),
      );
      entries++;
    }
  }
  // Out-of-scope landing page: some time absorbed quietly, the rest sent as a CR draft.
  const oosTask = jobTasks[jobs.koc].find((t) => t.out_of_scope)!;
  await withTenant(ctx("Zanele Khumalo", people.zanele), async (tx) => {
    await logTime(tx, people.zanele, { job_id: jobs.koc, task_id: oosTask.id, work_date: addDays(today, -6), hours: 3, oos_resolution: "absorbed", absorb_reason: "Client asked on a call; felt too small to raise" });
    await logTime(tx, people.zanele, { job_id: jobs.koc, task_id: oosTask.id, work_date: addDays(today, -3), hours: 4, oos_resolution: "change_request", notes: "Layout and build" });
  });
  console.log(`logged ${entries} time entries`);

  await withTenant(ctx("Jess Naidoo", people.jess), async (tx) => {
    await tx.q("update tasks set status = 'done', completed_at = now() where job_id = $1", [jobs.brochure]);
    await setJobStatus(tx, jobs.brochure, "complete");
    await closeJob(tx, jobs.brochure, { on_time: true, on_budget: false, rating: 4, lessons: "Print specs changed mid-job; lock printer specs at kick-off." });
    await tx.q("update jobs set completed_at = now() - interval '45 days', closed_at = now() - interval '40 days' where id = $1", [jobs.brochure]);
  });

  // ── Review and approval ──
  await withTenant(ctx("Kabelo Mahlangu", people.kabelo), async (tx) => {
    const scope = await tx.q<{ id: string; name: string }>("select id, name from scope_items where job_id = $1 order by created_at", [jobs.vela]);
    const kv = await createDeliverable(tx, { job_id: jobs.vela, name: "Key visual", scope_item_id: scope[0].id, approver_contact_id: c.velaApprover, due_date: addDays(today, -20) });
    await uploadVersion(tx, kv, svg("Care that comes to you", "#0f766e", "Key visual · route A"), "Route A");
    await internalDecision(tx, kv, "approved", "");
    await sendToClient(tx, kv);
    await tx.q("update deliverables set sent_to_client_at = now() - interval '9 days' where id = $1", [kv]);
    await clientDecision(tx, kv, { decision: "changes_requested", channel: "whatsapp", contactId: c.velaApprover, approverName: "Dr Priya Govender", note: "Can the nurse look warmer? And the logo bigger please" });
    await uploadVersion(tx, kv, svg("Care that comes to you", "#0e7490", "Key visual · v2 warmer"), "Warmer grade, bigger logo");
    await sendToClient(tx, kv);
    await tx.q("update deliverables set sent_to_client_at = now() - interval '6 days' where id = $1", [kv]);
    await clientDecision(tx, kv, { decision: "changes_requested", channel: "email", contactId: c.velaApprover, approverName: "Dr Priya Govender", note: "Our CEO wants to try a daytime setting" });
    await uploadVersion(tx, kv, svg("Care that comes to you", "#0369a1", "Key visual · v3 daytime"), "Daytime setting");
    // Rounds (2) are used up; the next send needs a change request or an absorb decision.

    const statics = await createDeliverable(tx, { job_id: jobs.vela, name: "Social statics (set of 6)", scope_item_id: scope[1].id, approver_contact_id: c.velaApprover, due_date: addDays(today, 3) });
    await uploadVersion(tx, statics, svg("Booked in minutes", "#7c3aed", "Social static 1 of 6"), "First set");
    await sendToClient(tx, statics);
    await tx.q("update deliverables set sent_to_client_at = now() - interval '3 days 4 hours' where id = $1", [statics]);

    const wire = await tx.q<{ id: string }>("select id from scope_items where job_id = $1 order by created_at", [jobs.koc]);
    const wf = await createDeliverable(tx, { job_id: jobs.koc, name: "Sitemap and wireframes", scope_item_id: wire[0].id, approver_contact_id: c.kocApprover, due_date: addDays(today, -55) });
    await uploadVersion(tx, wf, svg("Karoo Outdoor", "#b45309", "Sitemap and wireframes"), "");
    await sendToClient(tx, wf);
    await clientDecision(tx, wf, { decision: "approved", channel: "hub", contactId: c.kocApprover, approverName: "Megan Steyn", note: "Love it" });
    await tx.q("update deliverables set approved_at = now() - interval '50 days' where id = $1", [wf]);
    const pages = await createDeliverable(tx, { job_id: jobs.koc, name: "Page designs", scope_item_id: wire[1].id, approver_contact_id: c.kocApprover, due_date: addDays(today, -30) });
    await uploadVersion(tx, pages, svg("Find your weekend", "#a16207", "Home page design"), "");
    await sendToClient(tx, pages);
    await clientDecision(tx, pages, { decision: "approved", channel: "email", contactId: c.kocApprover, approverName: "Megan Steyn", note: "" });
    await tx.q("update deliverables set approved_at = now() - interval '26 days' where id = $1", [pages]);
    await tx.q("update milestones set status = 'complete', completed_at = now() - interval '20 days' where job_id = $1 and name like 'Designs%'", [jobs.koc]);
  });

  // ── Change requests ──
  await withTenant(ctx("Sipho Ndlovu", people.sipho), async (tx) => {
    const gift = await createChangeRequest(tx, { company_id: c.bcb, retainer_id: retainerId, title: "Extra stories for the Heritage Day weekend promo", origin: "request", estimate_hours: 8 });
    await absorbChangeRequest(tx, gift, "Goodwill: new marketing lead at Blue Crane");
    await tx.q("update change_requests set decided_at = now() - interval '25 days' where id = $1", [gift]);
    const video = await createChangeRequest(tx, { company_id: c.vela, job_id: jobs.vela, title: "15s cut-down of the launch video for YouTube pre-roll", description: "New edit from existing footage, 2 sizes", origin: "request", estimate_hours: 9 });
    await sendChangeRequest(tx, video);
    await submitClientRequest(tx, { company_id: c.bcb, contact_id: c.bcbCommenter, body: "Hey team, quick one: can you also do a version of this week's posts in isiZulu? Need it by tomorrow if possible 🙏", channel: "whatsapp" });
    await submitClientRequest(tx, { company_id: c.koc, contact_id: c.kocApprover, body: "Please swap the hero photo on the home page for the one attached in my email.", channel: "hub" });
  });

  // ── Retainer reconciliations and invoices ──
  await withTenant(ctx("Ayesha Patel", people.ayesha), async (tx) => {
    const periods = await tx.q<{ id: string; ends_on: string }>("select id, ends_on from retainer_periods where retainer_id = $1 order by starts_on", [retainerId]);
    if (periods[0]) await reconcilePeriod(tx, periods[0].id, "absorbed", "First month: building the relationship");
    if (periods[1]) await reconcilePeriod(tx, periods[1].id, "absorbed", "Heritage Day push");
    // periods[2] (last month) is left for the team to reconcile in the demo.
    const mmmPeriods = await tx.q<{ id: string; ends_on: string }>("select id, ends_on from retainer_periods where retainer_id = $1 and ends_on < $2 order by starts_on", [mmmRetainerId, today]);
    for (const p of mmmPeriods) await reconcilePeriod(tx, p.id, "absorbed", "Within agreed flex");

    const bill = async (companyId: string, filter: (k: string, d: string) => boolean, po: string, issued: string, paid: boolean) => {
      const items = (await readyToBill(tx, companyId)).filter((i) => filter(i.key, i.description));
      if (!items.length) return;
      const inv = await createInvoice(tx, companyId, items.map((i) => i.key), { po_number: po });
      await sendInvoice(tx, inv);
      const terms = (await tx.one<{ payment_terms_days: number }>("select payment_terms_days from companies where id = $1", [companyId]))!.payment_terms_days;
      await tx.q("update invoices set issue_date = $2::date, due_date = $3, sent_at = $2::date::timestamptz where id = $1", [inv, issued, addDays(issued, terms)]);
      if (paid) {
        const total = (await tx.one<{ total_cents: number }>("select total_cents from invoices where id = $1", [inv]))!.total_cents;
        await recordPayment(tx, inv, total, "EFT");
      }
    };
    const periodKeys = periods.map((p) => `retainer_period:${p.id}`);
    await bill(c.bcb, (k) => k === periodKeys[0], "BCB-PO-7781", periods[0] ? addDays(retainerStart, 1) : today, true);
    await bill(c.bcb, (k) => k === periodKeys[1], "BCB-PO-7790", addMonths(retainerStart, 1), true);
    await bill(c.bcb, (k) => k === periodKeys[2], "BCB-PO-7802", addMonths(retainerStart, 2), false);
    await bill(c.vela, (_k, d) => d.includes("Deposit"), "", addDays(today, -44), true);
    const mmmKeys = (await tx.q<{ id: string; ends_on: string }>("select id, ends_on from retainer_periods where retainer_id = $1 and ends_on < $2 order by starts_on", [mmmRetainerId, today]));
    for (const p of mmmKeys) await bill(c.mmm, (k) => k === `retainer_period:${p.id}`, "", addDays(p.ends_on, 2), true);
    await bill(c.koc, (_k, d) => d.includes("Deposit"), "", addDays(today, -52), false);
    await bill(c.koc, (_k, d) => d.includes("winter brochure"), "", addDays(today, -44), true);
    // The KOC "designs approved" milestone and BCB's current month stay in ready-to-bill, and MMM's T&M time stays unbilled.
  });

  // A few bookings of design and web time over the next working days.
  const workdays = Array.from({ length: 10 }, (_, i) => addDays(today, i + 1)).filter(isWeekday);
  await withTenant(ctx("Jess Naidoo", people.jess), async (tx) => {
    const scopeOf = async (jobId: string) => (await tx.one<{ id: string }>("select id from scope_items where job_id = $1 order by created_at limit 1", [jobId]))!.id;
    await createBooking(tx, { user_id: people.kabelo, job_id: jobs.guidelines, scope_item_id: await scopeOf(jobs.guidelines), work_date: workdays[0], start_time: "09:00", hours: 3, title: "Typography and colour pages" });
    await createBooking(tx, { user_id: people.zanele, job_id: jobs.guidelines, scope_item_id: await scopeOf(jobs.guidelines), work_date: workdays[0], start_time: "10:00", hours: 4, title: "Online brand portal build" });
    await createBooking(tx, { user_id: people.mia, job_id: jobs.guidelines, scope_item_id: await scopeOf(jobs.guidelines), work_date: workdays[1], start_time: "13:00", hours: 2.5, title: "Icon set" });
  });

  await seedChat(agencyId, people, c.vela);

  // Owner's internal review queue, notifications and outbox state.
  await withTenant(ctx("seed"), async (tx) => {
    await runAutomations(tx);
  });
  console.log("Seeded Sunday Studio. Log in at /login as owner@sundaystudio.example / demo1234");
  await closePools();
}

main().catch(async (e) => {
  console.error(e);
  await closePools();
  process.exit(1);
});
