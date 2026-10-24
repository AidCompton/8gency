# 8gency connectors: integration plan

Status: Phases 0–2 built (October 2026), awaiting app registration and live testing · Owner: product + engineering · In-app catalogue: `/app/connectors` (data in `src/lib/domain/connectors.ts`, code in `src/lib/connectors/`)

## Build status

| Piece | Where | Notes |
|---|---|---|
| Connections, token vault, OAuth | `migrations/006_connectors.sql`, `src/lib/vault.ts`, `src/lib/connectors/connections.ts`, `/api/connectors/*` | AES-256-GCM under `CONNECTOR_SECRET_KEY` (KMS envelope encryption still to do). One OAuth callback for every provider; state is signed and bound to the browser. |
| Sync worker | `src/lib/connectors/sync.ts`, run by `/api/cron` and "Sync now" | `sync_jobs` was folded into `connections` (`cursor`, `next_sync_at`, `failures`): each connection syncs every 15 minutes in its own transaction, backing off to 6 hours on failure. Token refresh commits separately so rotated refresh tokens (Xero) are never lost. |
| Outbox delivery | `src/lib/connectors/delivery.ts` | Gmail, Outlook, WhatsApp (template fallback outside 24h), Slack, Google Calendar events. Unconnected channels wait in the Outbox. |
| Automations | `slack_message`, `gmail_send`, `calendar_event` | Unlocked; each queues to the Outbox. |
| Timesheets | `src/lib/connectors/meetings.ts` | Google Calendar (incl. Meet), Outlook/Teams and Zoom meetings matched to a job by job number, attendee email/domain or client name. |
| Accounting | `src/lib/connectors/accounting.ts` | Xero and QuickBooks: push issued invoices, pull paid share back into `recordPayment`. |
| Ads and analytics | `src/lib/connectors/ads.ts` | Meta and Google Ads daily spend → re-billable costs (one per day, updated until invoiced), monthly budget alerts; GA4 weekly results. Both feed status reports. |
| CRM | `src/lib/connectors/hubspot.ts` | Closed-won deals → client, contacts, job from a chosen template. |
| Files | `src/lib/connectors/files.ts` | Drive, Dropbox and Figma links as proof versions; approved finals filed to a client folder (Drive, Dropbox). |
| Payments | `src/lib/connectors/payments.ts` | PayFast, Paystack, Stripe pay-now in the hub; signed webhooks record the payment once. |

Not built from this plan: Gmail reply capture (needs restricted-scope verification), Slack message shortcut for client requests, Xero contacts/tax-rate sync and credit notes, HubSpot two-way contact sync, Figma comment sync, Zoom actual (vs scheduled) duration and recordings.

## Why

Agencies already live in Gmail/Outlook, Calendar, Slack, WhatsApp, Drive, the ad platforms and their accounting tool. 8gency only pays off if the work done there **arrives in 8gency by itself**, matched to the right client and job, and if 8gency can **act** in those tools (send, post, book, invoice). Connectors are how the "nobody has to re-type it" promise extends beyond 8gency's own screens.

Each connector must do at least one of these, or it isn't worth building:

1. **Capture work**: meetings and emails become timesheet suggestions and client requests (less admin, more billable time found).
2. **Deliver**: messages 8gency already writes (Outbox, automations, invoices) go out through the agency's own channels.
3. **Count money**: ad spend, payments and accounting stay in step with jobs and invoices.
4. **Act in automations**: new trigger sources and new action steps in `/app/automations`.

## Principles

- **Least access.** Request the narrowest OAuth scopes per feature, and ask for more only when a feature that needs them is switched on (incremental consent).
- **Tenant-safe by construction.** Every connection, token, sync cursor and imported record carries `agency_id` and sits behind the same row-level security as the rest of the schema.
- **Tokens never touch the browser.** Stored encrypted (envelope encryption, a per-agency data key wrapped by a KMS master key), decrypted only inside the sync worker.
- **Idempotent, resumable sync.** Every external object gets a stable `(connection_id, external_id)` key; webhooks and polls can arrive twice or out of order without duplicating anything.
- **Human-confirmed mapping.** Auto-match an email, meeting or ad account to a client or job when confident; otherwise queue it for one-click confirmation (the same pattern as Scope Guard triage). Never guess silently on money.
- **POPIA / GDPR.** Show what is stored per connector, keep only what a feature uses (headers and snippets, not full mailboxes), honour disconnect plus "delete imported data", and log every connect and disconnect in the audit log.
- **Graceful when disconnected.** Expired tokens surface as a banner and a notification to the connector owner; automations fall back (e.g. queue in the Outbox) and log a clear error rather than failing silently.

## Architecture

```
            ┌───────────── /app/connectors (connect, status, settings) ─────────────┐
            │                                                                       │
 OAuth ───▶ connections (agency, provider, account, scopes, status, enc. tokens)    │
            │                                                                       │
 Webhooks ─▶ /api/connectors/[provider]/webhook ──▶ sync_jobs queue ◀── scheduler  │
            │                                          │                            │
            │                                 provider adapter (one per app)        │
            │                                          │                            │
            │          external_objects (connection, external_id, kind, payload)    │
            │                                          │                            │
            │      mapping: → client / job / contact / invoice  (auto or confirm)   │
            │                                          │                            │
            └──▶ 8gency features: timesheet suggestions · client requests · costs ·  │
                 status reports · invoices · automation triggers & actions ─────────┘
```

### Data model (migration sketch)

| Table | Purpose |
|---|---|
| `connections` | `agency_id, provider, account_label, external_account_id, scopes text[], status (active / needs_reauth / disconnected), encrypted_tokens bytea, token_expires_at, connected_by, settings jsonb` |
| `connection_mappings` | Provider object → 8gency record, e.g. Slack channel → client, Meta ad account → client/job, Drive folder → client. |
| `external_objects` | Normalised synced items: `connection_id, external_id, kind (email, event, file, spend_day, payment…), occurred_at, payload jsonb, matched_type, matched_id, status`. Unique `(connection_id, external_id)`. |
| `sync_jobs` | Durable queue: `connection_id, kind, cursor, run_after, attempts, last_error`. Exponential backoff and a per-provider rate-limit budget. |
| `connector_requests` | Already live: demand signal from the catalogue's "We want this" button. |

### Provider adapter contract

```ts
interface ProviderAdapter {
  provider: string;
  scopes(features: string[]): string[];                  // incremental consent
  exchangeCode(code: string): Promise<Tokens>;
  refresh(tokens: Tokens): Promise<Tokens>;
  sync(conn: Connection, cursor: string | null): Promise<{ items: ExternalItem[]; cursor: string | null }>;
  verifyWebhook?(req: Request): Promise<boolean>;
  actions?: Record<string, (conn: Connection, input: unknown) => Promise<ActionResult>>; // used by automations
}
```

### How connectors plug into what already exists

- **Automations.** The catalogue already reserves `slack_message`, `gmail_send` and `calendar_event` action steps (shown as "Soon" in the builder; the engine refuses to save them). When a connector ships, its executor goes into `execute()` in `src/lib/services/automationEngine.ts` and the step unlocks. New triggers (e.g. "Email from a client", "Meeting ended", "Ad spend over budget") are new entries in `TRIGGERS` fired with the existing `fireEvent()`.
- **Outbox.** Today messages queue in `outbox_messages`. Gmail/Outlook and WhatsApp Business become delivery transports for that queue: same rows, plus `status`, `provider_message_id` and the error.
- **Timesheets.** Calendar events and sent emails become `timesheetSuggestions` sources ("Because you had a 45-minute meeting with Vela Health").
- **Money.** Ad spend days become re-billable `costs` on the mapped job; accounting payments call `recordPayment`; issued invoices are pushed on `invoice.sent`.

## Per-connector notes (Phase 1)

| Connector | API | Scopes (start) | Sync | Notes |
|---|---|---|---|---|
| Gmail | Gmail API | `gmail.send`; later `gmail.readonly` (metadata) for reply capture | Push via Pub/Sub watch + history cursor | Restricted scopes need Google verification (and a security assessment for readonly). Start with send-only. |
| Google Calendar | Calendar API | `calendar.events.readonly`, later `calendar.events` | Push channels + sync token | Match attendees' email domains to client contacts. |
| Microsoft 365 | Microsoft Graph | `Mail.Send`, `Calendars.Read` | Graph change notifications + delta queries | One adapter covers Outlook mail and calendar. |
| Slack | Slack Web API + Events | `chat:write`, `channels:read`; later `channels:history` | Events API | Channel → client mapping; post automation steps; shortcut to log a client request. |
| WhatsApp Business | Meta Cloud API | Business system user token | Webhooks | Template messages need Meta approval; 24-hour session window rules. Replaces the Outbox WhatsApp stub; inbound already parsed by `/api/inbound`. |
| Xero | Xero Accounting API | `accounting.transactions`, `accounting.contacts`, `offline_access` | Webhooks + modified-since polling | Push on `invoice.sent`; pull payments → `recordPayment`; map tax rates. |

Phase 2 and 3 connectors follow the same contract; their in-app descriptions live in `CONNECTORS`.

## Rollout

| Phase | Scope | Exit criteria |
|---|---|---|
| 0: Foundation (2–3 wks) | `connections`, token vault, OAuth callback route, `sync_jobs` worker, webhook endpoint, connector status UI ("Connect" buttons replace "We want this"), audit events, disconnect + delete data | One provider connects, refreshes and disconnects cleanly in staging; security review of the vault |
| 1: Daily flow (6–8 wks) | Gmail send, Google Calendar → timesheet suggestions, Microsoft 365, Slack post + channel mapping, WhatsApp delivery, Xero invoice + payment sync; unlock the 3 reserved automation steps | Outbox delivers through the agency's own channels; timesheet suggestions include meetings; invoices reconcile from Xero with no manual entry |
| 2: Money and files (8–10 wks) | Meta/Google Ads spend → costs, GA4 in status reports, Drive/Dropbox/Figma proofing, HubSpot won-deal → client + job, PayFast/Paystack/Stripe pay-now, QuickBooks, Zoom/Meet time | Ad spend appears on jobs daily; clients can pay from the hub |
| 3: Long tail | LinkedIn/TikTok Ads, Canva, Mailchimp, Klaviyo, Sage, Teams, outbound webhooks, Zapier/Make app | Driven by `connector_requests` demand |

Prioritise inside each phase by `select connector, count(*) from connector_requests group by 1 order by 2 desc`.

## Risks and mitigations

- **Google restricted-scope verification** (Gmail read) can take weeks and needs a third-party security assessment → ship send-only first; apply for verification in Phase 0.
- **Meta WhatsApp template approval and fees** → keep templates few and generic ("You have something to review: {{1}}"); show costs in settings.
- **Mis-matched data** (an email filed to the wrong client) → confidence threshold + confirm queue; always reversible.
- **Token leakage** → envelope encryption, no tokens in logs, short-lived access tokens, rotation on suspicion.
- **Rate limits / provider outages** → per-provider budgets in `sync_jobs`, backoff, and status shown on the connector card.

## Open questions

1. Agency-level vs per-user connections for mail and calendar (proposal: agency-level for shared inboxes; per-user for calendars, opt-in).
2. Do we store email bodies? (Proposal: no. Subject, participants, snippet and a deep link only.)
3. Ad spend mark-up: default per client, or per job?
4. Which accounting system is the source of truth for payments when both 8gency and Xero record them? (Proposal: Xero, with 8gency matching on invoice number.)

## Success measures

- Share of billable hours that come from suggestions (target: 30%+ within a month of calendar sync).
- Days from milestone to invoice paid (target: −30%).
- Outbox messages delivered through connected channels (target: 90%+ once connected).
- Connectors requested vs connected, per phase.
