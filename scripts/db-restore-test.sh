#!/bin/sh
# Proves a backup can be restored: loads it into a throwaway database and checks
# the row counts match the live one. Run this after every change to backups, and monthly.
#   npm run db:restore-test -- backups/8gency-20261025-120000.dump
# Needs POSTGRES_SUPERUSER_URL (a role that may create databases).
set -eu
[ -f .env ] && . ./.env
dump="${1:?usage: npm run db:restore-test -- <backup file>}"
: "${DATABASE_ADMIN_URL:?DATABASE_ADMIN_URL is not set}"
: "${POSTGRES_SUPERUSER_URL:?POSTGRES_SUPERUSER_URL is not set}"
name="restore_test_$$"
base="${POSTGRES_SUPERUSER_URL%/*}"
psql "$POSTGRES_SUPERUSER_URL" -qc "create database $name"
trap 'psql "$POSTGRES_SUPERUSER_URL" -qc "drop database if exists $name" >/dev/null' EXIT
pg_restore --no-owner --no-privileges --exit-on-error -d "$base/$name" "$dump"
counts="select 'agencies', count(*) from agencies union all select 'users', count(*) from users union all select 'companies', count(*) from companies
 union all select 'jobs', count(*) from jobs union all select 'time_entries', count(*) from time_entries union all select 'invoices', count(*) from invoices
 union all select 'invoice_lines', count(*) from invoice_lines union all select 'versions', count(*) from versions union all select 'chat_messages', count(*) from chat_messages
 union all select 'audit_events', count(*) from audit_events order by 1"
live="$(psql "$DATABASE_ADMIN_URL" -At -c "$counts")"
restored="$(psql "$base/$name" -At -c "$counts")"
if [ "$live" = "$restored" ]; then
  echo "Restore OK: row counts match the live database."
  echo "$restored" | sed 's/|/: /'
else
  echo "RESTORE MISMATCH. Live vs restored:"; echo "$live" > /tmp/live.$$; echo "$restored" > /tmp/restored.$$
  diff /tmp/live.$$ /tmp/restored.$$ || true; rm -f /tmp/live.$$ /tmp/restored.$$
  exit 1
fi
