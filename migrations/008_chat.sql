-- Team chat: channels (public or private groups) and direct messages.
create table chat_channels (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  kind text not null default 'channel' check (kind in ('channel', 'dm')),
  name text not null default '',
  topic text not null default '',
  emoji text not null default '💬',
  category text not null default 'team' check (category in ('team', 'department', 'client', 'event', 'project', 'social')),
  private boolean not null default false,
  company_id uuid references companies(id) on delete set null,
  -- Sorted member ids, so a conversation between the same people is reused.
  dm_key text,
  is_default boolean not null default false,
  created_by uuid references users(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (agency_id, dm_key)
);
create unique index chat_channel_names on chat_channels (agency_id, lower(name)) where kind = 'channel' and archived_at is null;

create table chat_members (
  channel_id uuid not null references chat_channels(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  last_read_seq bigint not null default 0,
  joined_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);
create index on chat_members (user_id);

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  seq bigserial,
  agency_id uuid not null references agencies(id) on delete cascade,
  channel_id uuid not null references chat_channels(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  kind text not null default 'message' check (kind in ('message', 'kudos', 'system')),
  body text not null,
  mentions uuid[] not null default '{}',
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  -- Bumped on edit, delete and reactions, so open conversations pick up changes.
  updated_at timestamptz not null default now()
);
create index on chat_messages (channel_id, seq);
create index on chat_messages (channel_id, updated_at);

create table chat_reactions (
  message_id uuid not null references chat_messages(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  emoji text not null,
  primary key (message_id, user_id, emoji)
);

-- Who's around: refreshed while someone has the app open.
alter table users add column last_seen_at timestamptz;

do $$
declare t text;
begin
  foreach t in array array['chat_channels', 'chat_members', 'chat_messages', 'chat_reactions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (agency_id = current_agency_id()) with check (agency_id = current_agency_id())', t);
  end loop;
end $$;
