-- Per-job time billing: billable time on jobs with bill_time on flows into the
-- client's open draft invoice automatically. On by default for hourly (T&M)
-- jobs; fixed-fee, retainer and internal jobs opt in. bill_time_from lets a job
-- start billing from a date without sweeping up time logged before it.
alter table jobs
  add column bill_time boolean not null default false,
  add column bill_time_from date;
update jobs set bill_time = true where billing_model = 'tm';

-- Time deliberately not charged (removed from a draft invoice = written down).
-- Kept separate from category so utilisation still counts it as billable work.
alter table time_entries add column not_billed boolean not null default false;

-- Time lines are itemised per job, task and rate; the task lets later time join the same line.
alter table invoice_lines add column task_id uuid references tasks(id) on delete set null;

create index time_entries_unbilled on time_entries (job_id) where invoice_line_id is null and category = 'billable' and not not_billed;
