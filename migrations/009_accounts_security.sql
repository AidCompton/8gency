-- Accounts and security: login throttling, one-time tokens (password reset,
-- staff invites, agency invites), the waitlist, and 8gency's own account email.
-- None of these tables hold an agency's business data, so none is tenant-scoped.
-- Row-level security is switched on with no policy: the app role sees nothing
-- here, only the admin role (server-side auth code) can read and write them.

create table auth_attempts (
  id bigserial primary key,
  kind text not null check (kind in ('login', 'reset_request', 'waitlist')),
  -- A lowercased email or an IP address.
  identifier text not null,
  ok boolean not null default false,
  created_at timestamptz not null default now()
);
create index on auth_attempts (kind, identifier, created_at desc);

create table auth_tokens (
  token_hash text primary key,
  kind text not null check (kind in ('reset', 'staff_invite', 'agency_invite')),
  email text not null,
  agency_id uuid references agencies(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  -- Staff invite: name, role, title, team, hours, rates. Agency invite: who it's for.
  payload jsonb not null default '{}',
  created_by uuid references users(id) on delete set null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index on auth_tokens (email, kind);

create table waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text not null,
  agency_name text not null,
  team_size int,
  -- What they use today: { time, projects, accounting, email }, to rank integrations by demand.
  tools jsonb not null default '{}',
  note text not null default '',
  invited_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index waitlist_email on waitlist (lower(email));

-- Account email (reset links, invites). With no mail provider configured outside
-- production, messages are kept here so a developer or a test can read them.
create table system_mail (
  id bigserial primary key,
  to_address text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now()
);

alter table users add column email_verified_at timestamptz;
alter table users add column password_changed_at timestamptz;
update users set email_verified_at = created_at;

-- Client hub links expire 60 days after last use (not a fixed 180 days).
update contacts set hub_token_expires_at = least(coalesce(hub_token_expires_at, now() + interval '60 days'), now() + interval '60 days') where hub_token is not null;

do $$
declare t text;
begin
  foreach t in array array['auth_attempts', 'auth_tokens', 'waitlist', 'system_mail'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;
