#!/bin/sh
# A logical backup of the whole database to one file, restorable anywhere.
#   npm run db:backup                      -> backups/8gency-<timestamp>.dump
#   npm run db:backup -- /path/file.dump
# This is the portable copy you can also keep off the host. The host's
# point-in-time recovery (managed Postgres) is the main safety net; see docs/hosting.md.
set -eu
[ -f .env ] && . ./.env
: "${DATABASE_ADMIN_URL:?DATABASE_ADMIN_URL is not set}"
out="${1:-backups/8gency-$(date +%Y%m%d-%H%M%S).dump}"
mkdir -p "$(dirname "$out")"
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_ADMIN_URL" > "$out"
echo "Backed up to $out ($(wc -c < "$out" | tr -d ' ') bytes)"
