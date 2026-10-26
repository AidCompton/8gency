-- Idempotency keys: a retry of the same request (a double click, a flaky connection) is recognised and
-- answered with the first result instead of creating the record twice. Not tenant data; only the server reads it.
create table idempotency_keys (
  scope text not null,
  key text not null check (length(key) <= 255),
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (scope, key)
);
create index on idempotency_keys (created_at);
