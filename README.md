# 8gency

The operating system for advertising and marketing agencies: staff, clients, work and money in one place.

This repository is the **Phase 1 MVP ("the money loop")** from the 8gency product blueprint. It's built for agencies of 5 to 50 people and does three things:

- shows an agency where it loses money;
- turns out-of-scope work into priced, client-approved change requests;
- gets every billable item invoiced.

## Run it locally

Requirements: Node 20+ and PostgreSQL 14+.

```bash
cp .env.example .env          # set POSTGRES_SUPERUSER_URL to a superuser on your Postgres
npm install
npm run db:setup              # creates the app role (no BYPASSRLS), the admin role and the database
npm run db:migrate
npm run db:seed               # optional: a fictional 10-person agency with 90 days of history
npm run dev                   # http://localhost:3000
```

Demo logins (password `demo1234` for all of them):

| Email | Role |
|---|---|
| owner@sundaystudio.example | Owner / MD |
| ops@sundaystudio.example | Operations |
| finance@sundaystudio.example | Finance |
| sipho@sundaystudio.example | Account manager |
| jess@sundaystudio.example | Project manager |
| mia@sundaystudio.example | Designer (sees no money) |

Client hub links for the demo contacts are on each client page ("Open hub ↗").

```bash
npm test          # unit tests, plus tenant-isolation and operating-rule tests against Postgres
npm run typecheck
npm run build
```

## What's in Phase 1

Every module traces back to problem IDs in the blueprint (Part 2).

| Module | What works | Problems |
|---|---|---|
| **M01 Workspace** | Agency-type templates at sign-up, a South African VAT preset (15%), invoice numbering, rate cards per role with client overrides and effective dates (rates are snapshotted on each time entry), job-number format, brief threshold | PR-03, FN-11, PF-08 |
| **M04 Contracts & scope baseline** | Structured scope per job and retainer (deliverables or hours, quantity, rounds, inclusions, exclusions); the baseline locks on approval and then grows only through change requests; vague-wording detector; contracts with key dates and 90/60/30-day reminders; amendments supersede and never edit | PR-04, PR-05, PR-10, SC-02, LG-01 |
| **M05 Onboarding** | Checklist per client, approver/commenter/billing/legal roles, PO rules, 30/60/90-day check-ins | ON-01, ON-04, ON-06, ON-07 |
| **M06 Client Hub** | No login, a private link per contact; "waiting on you" with the clock; approve or request changes; comment with image pins or video timecodes; change-request decisions; retainer usage; invoices; request intake goes into triage | CL-02, CR-01, CR-03, PM-06, CL-15 |
| **M07 Briefs** | Required fields, a weighted completeness score, questions to send for missing fields; work can't start below the threshold without a recorded override | ON-02, PM-09 |
| **M08 Jobs & traffic** | Templates (phases, tasks, scope, billing schedule), a traffic view, budget burn and forecast, milestones, rush flag, close-out required before closing, no time on closed jobs without an override, recurring retainer jobs | PM-01, PM-02, PM-07, PM-10, PM-12, FN-16 |
| **M09 My Day** | One queue across clients: overdue, due today, blocked, waiting, feedback to action, reviews requested; each task shows the brief and its scope item; one-tap timer; workload meter | PM-04, SC-02, TT-01 |
| **M10 Review & approval** | Version stack, internal and client stages, immutable approval records (approver, version, stage, channel, time), rounds counted against scope; when the rounds run out, the next round needs a change request or an absorb decision | CR-01..04, SC-03 |
| **M11 Scope Guard** | Triage queue with out-of-scope phrase detection; change requests priced from the rate card, with an estimate based on similar past work; sent by link, email and WhatsApp; approval adds to the scope and the ready-to-bill queue; absorbed work is logged with a reason; out-of-scope time can't be logged unresolved (enforced in the database) | SC-01..07 |
| **M13 Time** | Timers, pre-filled timesheets built only from the person's own 8gency activity and visible only to them, categories, month-end locking, a compliance view for managers | TT-01..07 |
| **M14 Retainers** | Hours and deliverable banks, live burn against time elapsed with a mid-month alert, capped rollover, month-end reconciliation (overage billed or absorbed), annual price increase, period margin | SC-05, SC-08, FN-04, PR-07 |
| **M15 Billing** | Ready-to-bill queue (milestones, retainer periods, approved change requests, T&M time, re-billable costs with markup), flagged when items wait too long; tax invoices; PO numbers enforced; payments; write-offs with a reason category; debtors by age; automatic reminders and escalation; WIP valuation; month-end close; Xero CSV export | FN-01..07, FN-11, FN-14 |
| **M19 Pulse** | Agency Health Scan with a rand value on each finding; profit by client, job and service line; effective hourly rate; utilisation against per-person targets; client health score; owner dashboard | PF-01..09, LD-02 |
| **M25 8gent** | Explainable heuristics: out-of-scope detection, deadline-risk prediction, weekly WIP summary, estimates from history, client status-update drafts. Every draft lists its sources and needs human review. If `ANTHROPIC_API_KEY` is set, status updates are polished by Claude | SC-01, PM-05, RP-06, PR-01 |
| **M26 Automations & import** | Idempotent rule library (budget burn, overdue, approval chasing, ready-to-bill, retainer burn, collections, check-ins, renewals); CSV import for clients, time (Harvest/Toggl shape) and tasks (Asana/Monday shape) | TL-01, TL-02, FN-13 |
| **M27 Admin & audit** | Role permissions from blueprint 4.5; money fields hidden by role in views, exports and AI drafts; immutable audit log with before/after values; same-day access removal; full data export | KN-03, PE-11, TL-06 |

## Architecture

- **Next.js 16 (App Router)**: server components and server actions, in TypeScript throughout.
- **PostgreSQL with row-level security.** Every tenant table has `agency_id` and a forced RLS policy. The app connects as a role without `BYPASSRLS`, and `withTenant()` (`src/lib/db.ts`) sets `app.agency_id` per transaction. A separate admin connection is used only for sign-up, login, session lookup and resolving hub links. `tests/integration.test.ts` proves that one agency can't read or write another's rows.
- **Rules live in the database where it matters.** Approvals and audit events are immutable (triggers). Out-of-scope time must carry a resolution, absorbed work needs a reason, closed jobs need a close-out, and write-offs need a reason category (all check constraints).
- **Money is integer cents** with its currency, and tax is rounded once per invoice.
- **Layout:**
  - `src/lib/domain/`: pure, unit-tested logic (brief score, scope detection, retainer maths, metrics, money, dates, reply parsing).
  - `src/lib/services/`: database workflows, one file per module.
  - `src/app/app/`: the staff app.
  - `src/app/hub/`: the client hub.
  - `src/app/api/`: file serving, exports, inbound messages, the scheduler.

### Endpoints

| Route | Purpose |
|---|---|
| `POST /api/inbound/email`, `POST /api/inbound/whatsapp` | `{ from, text }` with header `x-8gency-secret`. Replies like `APPROVE 7K2QXM` or `CHANGES 7K2QXM bigger logo` act on the item when the sender matches the contact. Other messages from known contacts go to triage. |
| `POST /api/cron` | Runs the automation library for every agency (same secret). Schedule it every 15 minutes. |
| `GET /api/export/all`, `/time`, `/xero?from=&to=` | Data exports, permission-filtered and audit-logged. |

## What's not done yet (be clear with design partners)

- **Email and WhatsApp delivery.** Messages are written to an outbox (visible at `/app/outbox`), but no provider is connected. WhatsApp needs a Meta-verified business account and approved message templates. Inbound needs a provider adapter in front of `/api/inbound/*`.
- **Accounting.** There's only a Xero-format CSV export; there's no two-way sync. Check the column names, account codes and tax types against Xero's current import template before relying on it.
- **Payments.** Invoices show EFT details only. No PayFast, Paystack or Stripe links yet.
- **Auth.** Staff sign in with email and password. SSO (Google/Microsoft), 2FA and magic links are still to build.
- **Importers.** CSV only. There are no API connectors for Asana, Monday, Harvest, Toggl or Xero.
- **AI.** Detection and estimates are rule-based heuristics, not models. Voice-note transcription, brief-from-transcript and conflicting-feedback detection are not built.
- **Proofing.** Image pins and video timecodes work. Drawing, side-by-side compare, spec checks and delivery packs don't.
- **Files** are stored on local disk (`UPLOAD_DIR`). Move them to S3-compatible storage before multi-server deployment.
- **Availability** ignores leave and public holidays (leave belongs to M20 People in Phase 2).
- **Phase 2 and 3 modules** are not started: CRM and proposals (M02/M03), resource planning (M12), purchasing (M16), media (M17), reporting connectors (M18), people (M20), freelancers (M21), assets and vault (M22), rights register (M23) and comms hub (M24). In Phase 1 the scope baseline is built on the job rather than converted from an accepted proposal.
- **Tax and legal.** The 15% VAT preset, tax-invoice layout and POPIA wording are defaults. Confirm them with an accountant and legal counsel before launch.

## Demo data

`npm run db:seed` creates **Sunday Studio**, a fictional agency, with five fictional clients. The data is shaped so the Health Scan finds real issues:

- an overserviced social retainer;
- absorbed out-of-scope work;
- a key visual whose review rounds are used up;
- unbilled time-and-materials time;
- overdue invoices, including one for a client that requires PO numbers;
- a new client with an incomplete brief.

All names, emails and phone numbers are made up (`.example` domains).
