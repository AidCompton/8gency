-- 8gency core schema (Phase 1: the money loop)
--
-- Every tenant table carries agency_id and is protected by row-level security.
-- The application connects as a role WITHOUT bypassrls and sets
-- `app.agency_id` per transaction (see src/lib/db.ts). Problem IDs from the
-- blueprint are noted where a constraint enforces an operating rule.

-- ───────────────────────── M01 Workspace ─────────────────────────

create table agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  agency_type text not null default 'full_service',
  country text not null default 'ZA',
  timezone text not null default 'Africa/Johannesburg',
  base_currency text not null default 'ZAR',
  brand_color text not null default '#5b3df5',
  job_number_format text not null default '{CLIENT}-{YYYY}-{SEQ}',
  brief_threshold int not null default 70 check (brief_threshold between 0 and 100),
  bill_within_days int not null default 3,
  hours_per_day numeric(4,2) not null default 8,
  burn_alert_thresholds int[] not null default '{75,90,100}',
  ai_enabled boolean not null default true,
  time_locked_until date,
  created_at timestamptz not null default now()
);

create table entities (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  name text not null,
  legal_name text not null default '',
  currency text not null default 'ZAR',
  tax_label text not null default 'VAT',
  tax_rate numeric(6,4) not null default 0.15,
  tax_number text not null default '',
  registration_number text not null default '',
  address text not null default '',
  bank_details text not null default '',
  invoice_prefix text not null default 'INV-',
  next_invoice_seq int not null default 1,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  email text not null,
  name text not null,
  password_hash text not null,
  role text not null check (role in ('owner','ops','finance','account','pm','staff')),
  title text not null default 'Designer',
  weekly_hours numeric(5,2) not null default 40,
  target_utilisation numeric(4,3) not null default 0.70,
  cost_rate_cents int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index users_email_unique on users (lower(email));

create table sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Rate cards per role, optional client override, with effective dates (PR-03).
-- Time entries snapshot the rate in force, so future rate changes never alter
-- historical costing (M01 acceptance).
create table rate_cards (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  role_title text not null,
  company_id uuid,
  rate_cents int not null check (rate_cents >= 0),
  effective_from date not null default current_date,
  created_at timestamptz not null default now()
);

create table counters (
  agency_id uuid not null references agencies(id) on delete cascade,
  key text not null,
  value int not null default 0,
  primary key (agency_id, key)
);

-- ───────────────────── Companies, contacts, onboarding ─────────────────────

create table companies (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  name text not null,
  code text not null,
  kind text not null default 'client' check (kind in ('client','prospect','supplier')),
  status text not null default 'onboarding' check (status in ('onboarding','active','paused','former')),
  po_required boolean not null default false,
  payment_terms_days int not null default 30,
  billing_email text not null default '',
  currency text not null default 'ZAR',
  entity_id uuid references entities(id),
  account_manager_id uuid references users(id),
  satisfaction int check (satisfaction between 1 and 5),
  notes text not null default '',
  created_at timestamptz not null default now(),
  unique (agency_id, code)
);
alter table rate_cards add foreign key (company_id) references companies(id) on delete cascade;

create table contacts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  email text not null default '',
  phone text not null default '',
  role text not null default 'commenter' check (role in ('approver','commenter','billing','legal')),
  hub_token text unique,
  hub_token_expires_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table onboarding_items (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  label text not null,
  category text not null default 'general',
  client_facing boolean not null default false,
  done_at timestamptz,
  done_by text,
  sort int not null default 0
);

-- ───────────────────────── M14 Retainers ─────────────────────────

create table retainers (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  fee_cents bigint not null default 0,
  hours_per_period numeric(8,2) not null default 0,
  start_date date not null,
  end_date date,
  rollover text not null default 'none' check (rollover in ('none','capped')),
  rollover_cap_hours numeric(8,2) not null default 0,
  alert_margin numeric(4,3) not null default 0.10,
  billing_timing text not null default 'advance' check (billing_timing in ('advance','arrears')),
  price_increase_pct numeric(5,2) not null default 0,
  next_increase_date date,
  status text not null default 'active' check (status in ('active','ended')),
  job_template_key text,
  job_owner_id uuid references users(id),
  created_at timestamptz not null default now()
);

create table retainer_periods (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  retainer_id uuid not null references retainers(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  allocated_hours numeric(8,2) not null,
  rollover_in_hours numeric(8,2) not null default 0,
  fee_cents bigint not null default 0,
  status text not null default 'open' check (status in ('open','reconciled')),
  used_hours numeric(8,2),
  overage_hours numeric(8,2),
  rollover_out_hours numeric(8,2),
  overage_action text check (overage_action in ('change_request','absorbed','none')),
  reconciled_at timestamptz,
  unique (retainer_id, starts_on)
);

-- ───────────────────────── M08 Jobs ─────────────────────────

create table jobs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  company_id uuid not null references companies(id),
  retainer_id uuid references retainers(id),
  number text not null,
  name text not null,
  job_type text not null default 'campaign',
  status text not null default 'briefing'
    check (status in ('briefing','in_progress','waiting_client','complete','closed')),
  billing_model text not null default 'fixed' check (billing_model in ('fixed','tm','retainer','internal')),
  owner_id uuid references users(id),
  account_manager_id uuid references users(id),
  start_date date,
  due_date date,
  budget_hours numeric(8,2) not null default 0,
  fee_cents bigint not null default 0,
  rush boolean not null default false,
  brief_override_reason text,
  brief_override_by text,
  scope_locked_at timestamptz,
  completed_at timestamptz,
  closed_at timestamptz,
  closeout_on_time boolean,
  closeout_on_budget boolean,
  closeout_rating int check (closeout_rating between 1 and 5),
  closeout_lessons text,
  created_at timestamptz not null default now(),
  unique (agency_id, number),
  -- Rule 15: every job closes with a short review.
  check (status <> 'closed' or (closeout_on_time is not null and closeout_on_budget is not null and coalesce(closeout_lessons,'') <> ''))
);

-- ───────────────── M04 Scope baseline (the hinge) ─────────────────

create table scope_items (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  job_id uuid references jobs(id) on delete cascade,
  retainer_id uuid references retainers(id) on delete cascade,
  name text not null,
  unit text not null default 'deliverable' check (unit in ('deliverable','hours')),
  quantity numeric(8,2) not null default 1,
  rounds_allowed int not null default 2,
  inclusions text not null default '',
  exclusions text not null default '',
  source text not null default 'baseline' check (source in ('baseline','change_request')),
  change_request_id uuid,
  created_at timestamptz not null default now(),
  check (job_id is not null or retainer_id is not null)
);

-- Contracts: MSAs, SOWs, NDAs with key dates (M04, LG-01). A signed contract
-- is never edited; an amendment is a new row that supersedes it.
create table contracts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  kind text not null default 'sow' check (kind in ('msa','sow','nda','freelancer','other')),
  title text not null,
  file_name text,
  file_path text,
  ip_terms text not null default '',
  starts_on date,
  ends_on date,
  notice_days int not null default 30,
  renewal_on date,
  price_increase_on date,
  signed_at timestamptz,
  signed_by text,
  supersedes_id uuid references contracts(id),
  created_at timestamptz not null default now()
);

-- ───────────────────────── M07 Briefs ─────────────────────────

create table briefs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  job_id uuid not null unique references jobs(id) on delete cascade,
  objective text not null default '',
  audience text not null default '',
  key_message text not null default '',
  deliverables text not null default '',
  must_haves text not null default '',
  budget text not null default '',
  deadline date,
  approver_contact_id uuid references contacts(id),
  success_measure text not null default '',
  references_text text not null default '',
  submitted_by text not null default 'internal' check (submitted_by in ('internal','client')),
  signed_off_at timestamptz,
  signed_off_by text,
  updated_at timestamptz not null default now()
);

-- ───────────────────────── Tasks & milestones ─────────────────────────

create table change_requests (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  job_id uuid references jobs(id) on delete cascade,
  retainer_id uuid references retainers(id) on delete cascade,
  deliverable_id uuid,
  retainer_period_id uuid references retainer_periods(id) on delete set null,
  title text not null,
  description text not null default '',
  origin text not null default 'manual' check (origin in ('request','time','rounds','retainer_overage','manual')),
  estimate_hours numeric(8,2) not null default 0,
  price_cents bigint not null default 0,
  status text not null default 'draft' check (status in ('draft','sent','approved','declined','absorbed')),
  absorb_reason text,
  created_by uuid references users(id),
  sent_at timestamptz,
  decided_at timestamptz,
  decided_by text,
  decided_channel text,
  scope_item_id uuid references scope_items(id),
  created_at timestamptz not null default now(),
  -- Absorbed scope is recorded as an investment with a reason (M11).
  check (status <> 'absorbed' or coalesce(absorb_reason,'') <> '')
);
alter table scope_items add foreign key (change_request_id) references change_requests(id) on delete set null;

create table tasks (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  scope_item_id uuid references scope_items(id) on delete set null,
  out_of_scope boolean not null default false,
  change_request_id uuid references change_requests(id) on delete set null,
  title text not null,
  notes text not null default '',
  assignee_id uuid references users(id),
  status text not null default 'todo' check (status in ('todo','in_progress','blocked','waiting_client','done')),
  due_date date,
  estimate_hours numeric(6,2) not null default 0,
  blocked_reason text,
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  completed_at timestamptz
);

create table milestones (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  name text not null,
  amount_cents bigint not null default 0,
  due_date date,
  trigger text not null default 'manual' check (trigger in ('start','completion','manual')),
  status text not null default 'pending' check (status in ('pending','complete','invoiced')),
  completed_at timestamptz,
  sort int not null default 0
);

-- ───────────────────── M10 Review and approval ─────────────────────

create table deliverables (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  scope_item_id uuid references scope_items(id) on delete set null,
  name text not null,
  status text not null default 'draft'
    check (status in ('draft','internal_review','client_review','changes_requested','approved')),
  rounds_used int not null default 0,
  extra_rounds int not null default 0,
  approver_contact_id uuid references contacts(id),
  sent_to_client_at timestamptz,
  approved_at timestamptz,
  due_date date,
  created_at timestamptz not null default now()
);

create table versions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  deliverable_id uuid not null references deliverables(id) on delete cascade,
  number int not null,
  file_name text not null,
  file_path text not null,
  mime text not null default 'application/octet-stream',
  size_bytes bigint not null default 0,
  notes text not null default '',
  uploaded_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (deliverable_id, number)
);

create table feedback (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  deliverable_id uuid not null references deliverables(id) on delete cascade,
  version_id uuid references versions(id) on delete cascade,
  author_user_id uuid references users(id),
  author_contact_id uuid references contacts(id),
  author_name text not null,
  channel text not null default 'app' check (channel in ('app','hub','email','whatsapp')),
  body text not null,
  pin_x numeric(5,2),
  pin_y numeric(5,2),
  timecode numeric(10,2),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- Approvals are immutable: approver, version, stage, channel, timestamp (Rule 6, CR-03).
create table approvals (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  subject_type text not null check (subject_type in ('deliverable','change_request','brief')),
  subject_id uuid not null,
  version_id uuid references versions(id),
  version_number int,
  stage text not null check (stage in ('internal','client')),
  decision text not null check (decision in ('approved','changes_requested','declined')),
  approver_user_id uuid references users(id),
  approver_contact_id uuid references contacts(id),
  approver_name text not null,
  channel text not null check (channel in ('app','hub','email','whatsapp')),
  note text not null default '',
  created_at timestamptz not null default now()
);

-- ─────────────── M06 Client Hub intake & action tokens ───────────────

create table client_requests (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  contact_id uuid references contacts(id),
  job_id uuid references jobs(id),
  body text not null,
  channel text not null default 'hub' check (channel in ('hub','email','whatsapp','app')),
  oos_score int not null default 0,
  oos_signals text[] not null default '{}',
  status text not null default 'new' check (status in ('new','accepted','change_request','dismissed')),
  task_id uuid references tasks(id),
  change_request_id uuid references change_requests(id),
  triaged_by text,
  triaged_at timestamptz,
  created_at timestamptz not null default now()
);

-- Short reference codes used in email and WhatsApp messages ("reply APPROVE 7K2Q").
create table action_tokens (
  code text primary key,
  agency_id uuid not null references agencies(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  subject_type text not null check (subject_type in ('deliverable','change_request')),
  subject_id uuid not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table outbox_messages (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  channel text not null check (channel in ('email','whatsapp')),
  to_name text not null default '',
  to_address text not null,
  subject text not null default '',
  body text not null,
  related_type text,
  related_id uuid,
  status text not null default 'queued' check (status in ('queued','sent','failed')),
  created_at timestamptz not null default now()
);

-- ───────────────────────── M13 Time ─────────────────────────

create table time_entries (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  user_id uuid not null references users(id),
  job_id uuid not null references jobs(id),
  task_id uuid references tasks(id) on delete set null,
  scope_item_id uuid references scope_items(id) on delete set null,
  work_date date not null,
  hours numeric(6,2) not null check (hours > 0 and hours <= 24),
  category text not null default 'billable'
    check (category in ('billable','non_billable_client','new_business','internal','training','admin')),
  notes text not null default '',
  rate_cents int not null default 0,
  cost_cents int not null default 0,
  out_of_scope boolean not null default false,
  oos_resolution text check (oos_resolution in ('change_request','absorbed')),
  change_request_id uuid references change_requests(id),
  absorb_reason text,
  source text not null default 'manual' check (source in ('timer','manual','suggestion','import')),
  locked boolean not null default false,
  invoice_line_id uuid,
  created_at timestamptz not null default now(),
  -- M11 acceptance: out-of-scope work is either a change request or absorbed with a reason.
  check (not out_of_scope
         or (oos_resolution = 'change_request' and change_request_id is not null)
         or (oos_resolution = 'absorbed' and coalesce(absorb_reason,'') <> ''))
);

-- Each person's own activity in 8gency. Feeds pre-filled timesheets (M13) and
-- is only ever shown back to that person until they confirm (TT-07).
create table activity_events (
  id bigserial primary key,
  agency_id uuid not null references agencies(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  job_id uuid references jobs(id) on delete cascade,
  task_id uuid references tasks(id) on delete cascade,
  kind text not null,
  at timestamptz not null default now()
);
create index on activity_events (user_id, at);

create table timers (
  user_id uuid primary key references users(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  task_id uuid references tasks(id) on delete cascade,
  started_at timestamptz not null default now()
);

-- ───────────────────── M15 Billing, M16 costs (light) ─────────────────────

create table invoices (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  entity_id uuid not null references entities(id),
  company_id uuid not null references companies(id),
  number text,
  status text not null default 'draft' check (status in ('draft','sent','paid','void')),
  issue_date date,
  due_date date,
  currency text not null default 'ZAR',
  exchange_rate numeric(12,6) not null default 1,
  po_number text not null default '',
  tax_label text not null default 'VAT',
  tax_rate numeric(6,4) not null default 0.15,
  subtotal_cents bigint not null default 0,
  tax_cents bigint not null default 0,
  total_cents bigint not null default 0,
  paid_cents bigint not null default 0,
  paid_at timestamptz,
  sent_at timestamptz,
  reminders_sent int not null default 0,
  last_reminder_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  unique (agency_id, number)
);

create table invoice_lines (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  job_id uuid references jobs(id),
  description text not null,
  quantity numeric(10,2) not null default 1,
  unit_cents bigint not null default 0,
  amount_cents bigint not null default 0,
  source_type text not null default 'manual'
    check (source_type in ('milestone','retainer_period','change_request','time','cost','manual')),
  source_id uuid,
  sort int not null default 0
);
alter table time_entries add foreign key (invoice_line_id) references invoice_lines(id) on delete set null;

create table costs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  supplier text not null default '',
  description text not null,
  amount_cents bigint not null,
  incurred_on date not null default current_date,
  rebillable boolean not null default true,
  markup numeric(5,4) not null default 0.15,
  invoice_line_id uuid references invoice_lines(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Every write-off has a reason category (M15 acceptance, FN-14).
create table write_offs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  company_id uuid not null references companies(id),
  job_id uuid references jobs(id),
  invoice_id uuid references invoices(id),
  amount_cents bigint not null check (amount_cents > 0),
  reason text not null check (reason in ('pricing_error','scope_absorbed','quality_issue','client_dispute','goodwill')),
  note text not null default '',
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

-- ───────────────── Notifications and M27 audit ─────────────────

create table notifications (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  href text not null default '',
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (agency_id, user_id, dedupe_key)
);

create table audit_events (
  id bigserial primary key,
  agency_id uuid not null references agencies(id) on delete cascade,
  actor_user_id uuid references users(id),
  actor_label text not null,
  action text not null,
  record_type text not null,
  record_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

-- ───────────────────────── Indexes ─────────────────────────

alter table change_requests add foreign key (deliverable_id) references deliverables(id) on delete set null;

create index on jobs (agency_id, status);
create index on jobs (company_id);
create index on tasks (assignee_id, status);
create index on tasks (job_id);
create index on time_entries (agency_id, work_date);
create index on time_entries (job_id);
create index on time_entries (user_id, work_date);
create index on scope_items (job_id);
create index on scope_items (retainer_id);
create index on deliverables (job_id);
create index on approvals (subject_type, subject_id);
create index on invoices (agency_id, status);
create index on invoice_lines (invoice_id);
create index on change_requests (agency_id, status);
create index on client_requests (agency_id, status);
create index on notifications (user_id, read_at);
create index on audit_events (agency_id, created_at desc);

-- ───────────────── Immutability for approvals and audit ─────────────────

create function forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception '% rows are immutable', tg_table_name;
end $$;

create trigger approvals_immutable before update or delete on approvals
  for each row execute function forbid_mutation();
create trigger audit_immutable before update or delete on audit_events
  for each row execute function forbid_mutation();

-- ───────────────── Row-level security (tenant isolation) ─────────────────

create function current_agency_id() returns uuid language sql stable as $$
  select nullif(current_setting('app.agency_id', true), '')::uuid
$$;

do $$
declare t text;
begin
  for t in
    select unnest(array[
      'entities','users','sessions','rate_cards','counters','companies','contacts','onboarding_items','contracts','activity_events',
      'retainers','retainer_periods','jobs','scope_items','briefs','change_requests','tasks','milestones',
      'deliverables','versions','feedback','approvals','client_requests','action_tokens','outbox_messages',
      'time_entries','timers','invoices','invoice_lines','costs','write_offs','notifications','audit_events'
    ])
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (agency_id = current_agency_id()) with check (agency_id = current_agency_id())', t);
  end loop;
end $$;

alter table agencies enable row level security;
alter table agencies force row level security;
create policy tenant_isolation on agencies using (id = current_agency_id()) with check (id = current_agency_id());
