-- Which team each person sits in. Design and web people can be booked by
-- anyone (Book time); the team is set in Settings › Team.
alter table users add column team text check (team in ('design', 'web', 'content', 'social', 'account', 'strategy', 'management', 'finance'));
update users set team = case
  when title ~* 'creative director|director|owner|founder|md\b' then 'management'
  when title ~* 'design|art|illustrat|motion|anima' then 'design'
  when title ~* 'develop|web|engineer|front.?end|back.?end|ux' then 'web'
  when title ~* 'copy|content|writer|editor' then 'content'
  when title ~* 'social|community' then 'social'
  when title ~* 'account|client' then 'account'
  when title ~* 'strateg|planner' then 'strategy'
  when title ~* 'finance|bookkeep|account' then 'finance'
  when title ~* 'project|producer|traffic|operations' then 'management'
end;

-- A booking reserves a person's time on a job, against an agreed scope item
-- and the job's hour budget. Each booking is also a task on the person's
-- My Day (task_id), so time logged against it counts as using the booking.
create table bookings (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  scope_item_id uuid not null references scope_items(id),
  task_id uuid references tasks(id) on delete set null,
  booked_by uuid references users(id) on delete set null,
  work_date date not null,
  start_time time not null,
  hours numeric(5,2) not null check (hours > 0 and hours <= 12),
  title text not null,
  notes text not null default '',
  status text not null default 'booked' check (status in ('booked', 'declined', 'cancelled')),
  decline_reason text,
  created_at timestamptz not null default now()
);
create index on bookings (agency_id, user_id, work_date) where status = 'booked';
create index on bookings (job_id) where status = 'booked';

alter table bookings enable row level security;
alter table bookings force row level security;
create policy tenant_isolation on bookings using (agency_id = current_agency_id()) with check (agency_id = current_agency_id());
