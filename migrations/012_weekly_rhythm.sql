-- The weekly rhythm: Monday email to owners, Friday timesheet reminder to everyone.
-- Each carries the local date it last went out, so a scheduler that runs every few
-- minutes sends once a week and a restart never sends twice.
alter table users add column weekly_email boolean not null default true;
alter table users add column weekly_email_sent_on date;
alter table users add column timesheet_reminders boolean not null default true;
alter table users add column timesheet_reminded_on date;
