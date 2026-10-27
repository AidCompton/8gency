-- Usage counts for running and improving the product: which feature was used and on which day, and which
-- people were active on which day. Counts only. Never content: no names of jobs, clients, messages or amounts.
create table usage_days (
  agency_id uuid not null references agencies(id) on delete cascade,
  day date not null,
  feature text not null,
  n int not null default 0,
  primary key (agency_id, day, feature)
);

create table active_days (
  agency_id uuid not null references agencies(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  day date not null,
  primary key (user_id, day)
);
create index on active_days (agency_id, day);

alter table usage_days enable row level security;
alter table usage_days force row level security;
create policy tenant_isolation on usage_days using (agency_id = current_agency_id()) with check (agency_id = current_agency_id());
alter table active_days enable row level security;
alter table active_days force row level security;
create policy tenant_isolation on active_days using (agency_id = current_agency_id()) with check (agency_id = current_agency_id());
