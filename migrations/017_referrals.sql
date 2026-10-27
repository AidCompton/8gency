-- Referrals: an agency shares a link; when the agency it brings in has stayed 60 days, the referrer earns a free month.
alter table agencies add column referral_code text;
update agencies set referral_code = upper(substr(md5(id::text || random()::text), 1, 8)) where referral_code is null;
alter table agencies alter column referral_code set not null;
alter table agencies alter column referral_code set default upper(substr(md5(gen_random_uuid()::text), 1, 8));
create unique index agencies_referral_code on agencies (referral_code);

alter table waitlist add column referral_code text;

create table referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_agency_id uuid not null references agencies(id) on delete cascade,
  referred_agency_id uuid unique references agencies(id) on delete cascade,
  referred_email text not null,
  referred_agency_name text not null,
  status text not null default 'waiting' check (status in ('waiting', 'signed_up', 'qualified', 'void')),
  created_at timestamptz not null default now(),
  signed_up_at timestamptz,
  qualified_at timestamptz
);
create unique index referrals_email on referrals (lower(referred_email));
create index on referrals (referrer_agency_id);

-- Free months earned, waiting to be taken off a bill once billing is live.
create table agency_credits (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  referral_id uuid references referrals(id) on delete set null,
  months int not null default 1 check (months > 0),
  reason text not null,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);
create index on agency_credits (agency_id);

-- Cross-agency, so never reachable from the application role: only the server's admin connection reads these.
alter table referrals enable row level security;
alter table referrals force row level security;
alter table agency_credits enable row level security;
alter table agency_credits force row level security;
