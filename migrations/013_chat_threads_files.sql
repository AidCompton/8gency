-- Chat threads (a reply hangs off one top-level message) and file attachments.

alter table chat_messages add column parent_id uuid references chat_messages(id) on delete cascade;
create index on chat_messages (parent_id, seq) where parent_id is not null;

-- Files live in Postgres for now (small teams, 10 MB each). An upload belongs to
-- nobody's message until it is sent with one; unsent uploads are swept after a day.
create table chat_files (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  channel_id uuid not null references chat_channels(id) on delete cascade,
  message_id uuid references chat_messages(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  name text not null,
  mime text not null,
  size int not null check (size > 0),
  data bytea not null,
  created_at timestamptz not null default now()
);
create index on chat_files (message_id);
create index on chat_files (agency_id);
alter table chat_files enable row level security;
alter table chat_files force row level security;
create policy tenant_isolation on chat_files using (agency_id = current_agency_id()) with check (agency_id = current_agency_id());
