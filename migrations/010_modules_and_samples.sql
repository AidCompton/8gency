-- Per-agency module switches, loose bookings, chat email nudges and sample data.

-- Which modules an agency uses (chat, bookings, team workload, automations) and
-- how strict booking is. Empty means "the defaults" (see src/lib/domain/modules.ts).
alter table agencies add column modules jsonb not null default '{}';

-- In loose mode a booking needs only a job and a time, not a scope item.
alter table bookings alter column scope_item_id drop not null;

-- Chat nudges: unread mentions and DMs are emailed once, after a few minutes.
alter table notifications add column emailed_at timestamptz;
create index on notifications (created_at) where emailed_at is null and kind in ('chat', 'kudos');
alter table users add column chat_nudges boolean not null default true;

-- Sample agency: people, clients and the work on them, all clearable in one click.
alter table companies add column is_sample boolean not null default false;
alter table users add column is_sample boolean not null default false;
alter table agencies add column sample_loaded_at timestamptz;
