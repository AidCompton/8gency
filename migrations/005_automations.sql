-- Automations as a first-class tool: built-in rules that can be switched off,
-- plus custom automations built from a trigger, optional filters and actions.
create table automations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  name text not null,
  description text not null default '',
  enabled boolean not null default true,
  -- Key of a built-in rule (implemented in code); null for a custom automation.
  builtin text,
  -- Which template a custom automation started from (for the gallery's "in use" state).
  template_key text,
  trigger jsonb not null default '{}',   -- { type, config }
  filters jsonb not null default '[]',   -- [{ field, value }]
  actions jsonb not null default '[]',   -- [{ type, config }]
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_run_at timestamptz,
  run_count int not null default 0,
  unique (agency_id, builtin)
);

-- Every run, for the activity log. record_key de-duplicates scheduled triggers
-- (one run per automation per record, e.g. "invoice:<id>").
create table automation_runs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  automation_id uuid not null references automations(id) on delete cascade,
  record_key text not null,
  status text not null check (status in ('ok', 'error', 'skipped')),
  summary text not null default '',
  created_at timestamptz not null default now(),
  unique (automation_id, record_key)
);
create index on automation_runs (agency_id, created_at desc);

-- Which connectors agencies ask for, to plan the integration roadmap.
create table connector_requests (
  agency_id uuid not null references agencies(id) on delete cascade,
  connector text not null,
  user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (agency_id, connector)
);

do $$
declare t text;
begin
  foreach t in array array['automations', 'automation_runs', 'connector_requests'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (agency_id = current_agency_id()) with check (agency_id = current_agency_id())', t);
  end loop;
end $$;
