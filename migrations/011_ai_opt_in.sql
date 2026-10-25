-- 8gent AI drafting is opt-in: a new agency starts with it off. Agencies that already
-- chose or accepted the old default keep what they have.
alter table agencies alter column ai_enabled set default false;
