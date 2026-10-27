-- Connectors: one row per connected app account. Agency-wide connections
-- (Gmail, Slack, Xero…) have user_id null; personal ones (calendars, Zoom)
-- belong to the person who connected them. Tokens and API keys are stored
-- encrypted (src/lib/vault.ts) and never leave the server.
create table connections (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  provider text not null,
  user_id uuid references users(id) on delete cascade,
  account_label text not null default '',
  external_account_id text not null default '',
  scopes text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'needs_reauth')),
  secret bytea,
  token_expires_at timestamptz,
  settings jsonb not null default '{}',
  -- Sync bookkeeping: an opaque provider cursor, the next due time and a failure count for backoff.
  cursor text,
  next_sync_at timestamptz not null default now(),
  failures int not null default 0,
  last_sync_at timestamptz,
  last_error text,
  connected_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index connections_one_per_owner on connections (agency_id, provider, coalesce(user_id, '00000000-0000-0000-0000-000000000000'));

-- A provider object mapped to 8gency: Slack channel → client, ad account → job,
-- GA4 property → client, Drive folder → client, HubSpot pipeline → job template.
create table connection_mappings (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  connection_id uuid not null references connections(id) on delete cascade,
  external_id text not null,
  external_label text not null default '',
  company_id uuid references companies(id) on delete cascade,
  job_id uuid references jobs(id) on delete set null,
  settings jsonb not null default '{}',
  unique (connection_id, external_id)
);

-- Everything synced in, keyed by the provider's id so repeats never duplicate.
create table external_objects (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  connection_id uuid not null references connections(id) on delete cascade,
  kind text not null,
  external_id text not null,
  occurred_on date,
  payload jsonb not null default '{}',
  -- What it was matched to in 8gency (a job, an invoice, a cost…).
  matched_type text,
  matched_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, kind, external_id)
);
create index on external_objects (agency_id, kind, occurred_on);
create index on external_objects (matched_type, matched_id);

-- The outbox becomes the delivery queue for every connected channel.
alter table outbox_messages drop constraint outbox_messages_channel_check;
alter table outbox_messages add constraint outbox_messages_channel_check check (channel in ('email', 'whatsapp', 'slack', 'calendar'));
alter table outbox_messages
  add column via text,                       -- connector to send through (null = the agency's default)
  add column payload jsonb not null default '{}',
  add column attempts int not null default 0,
  add column error text,
  add column provider_message_id text,
  add column sent_at timestamptz;
create index on outbox_messages (agency_id, status, created_at);

-- Ad spend and other imported costs point back to where they came from.
alter table costs add column source text not null default 'manual';

do $$
declare t text;
begin
  foreach t in array array['connections', 'connection_mappings', 'external_objects'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (agency_id = current_agency_id()) with check (agency_id = current_agency_id())', t);
  end loop;
end $$;
