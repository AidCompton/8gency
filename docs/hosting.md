# Hosting and operations

What's built, what needs your decisions, and the "if it breaks" runbook (draft).

## Decisions I need from you

1. **Cloud account and region.** The plan is a South African region (AWS Cape Town `af-south-1` or Azure South Africa North) so customer data stays in the country. Pick one and create the account under the company once it exists.
2. **Managed Postgres** with point-in-time recovery turned on, automated daily snapshots, encryption at rest, and a private network connection from the app. Choose 7 or 14 days of recovery (longer costs more).
3. **File storage for uploads.** Proof files and logos currently live on local disk (`UPLOAD_DIR`), which does not survive a redeploy. Use object storage (S3 or Azure Blob) with encryption and versioning. The code needs a small change to write there (not done yet).
4. **Where the app runs.** The `Dockerfile` builds one image. Run it on a managed container service (AWS App Runner/ECS, Azure Container Apps) behind HTTPS, with at least two instances so a restart doesn't mean downtime. Not tested: Docker isn't installed on this machine.
5. **Secrets vault** (AWS Secrets Manager or Azure Key Vault) for `CONNECTOR_SECRET_KEY`, the database URLs and the mail key, injected as environment variables at start. Never in the image or the repo.
6. **Account email** provider: Resend is wired in (`RESEND_API_KEY`, `SYSTEM_MAIL_FROM`). Verify the sending domain (SPF, DKIM) first.
7. **A scheduler** calling `POST /api/cron` with the `x-8gency-secret` header every 5 to 15 minutes (EventBridge Scheduler, Azure Logic Apps, or any cron).
8. **Status page**: a free hosted one (Better Stack, Instatus) watching `GET /api/health`.
9. **A reverse proxy or load balancer that sets `X-Forwarded-For`.** Login throttling uses it for the IP limit. If the app is reachable directly, a client can fake it.

## Environment variables (production)

| Variable | What |
|---|---|
| `DATABASE_URL`, `DATABASE_ADMIN_URL` | App role (no bypass of row security) and admin role. Both required; the app role must not be a superuser. |
| `APP_URL` | The public `https://` address. Used in every emailed link. |
| `INBOUND_WEBHOOK_SECRET` | Long random value; protects `/api/cron` and `/api/inbound/*`. Not `change-me`. |
| `CONNECTOR_SECRET_KEY` | 32 random bytes, base64. Losing it makes saved connections unreadable: back it up in the vault. |
| `RESEND_API_KEY`, `SYSTEM_MAIL_FROM` | Account email. |
| `UPLOAD_DIR` | Until object storage is wired in, must be a persistent disk. |
| Connector client IDs and secrets | See `.env.example`. Only needed for connectors you switch on. |

## Release steps

1. `docker build` and push the image.
2. Run migrations from the same image against the database: `npm run db:migrate`.
3. Start the new instances, wait for `/api/health`, then retire the old ones.
4. Check the log for errors for ten minutes.

## Backups

- The host's **point-in-time recovery** is the main safety net.
- `npm run db:backup` writes a portable copy (`backups/*.dump`) you can also keep off the host. Run it before every risky release.
- `npm run db:restore-test -- <file>` restores a dump into a throwaway database and checks the row counts match the live one. **Done once locally (counts matched). Repeat it against the real host before the pilot, then monthly.** A backup you haven't restored is a hope.

## If it breaks (runbook draft)

| Symptom | First checks | Fix |
|---|---|---|
| Everything returns errors | `/api/health`, the host's service dashboard, the database status | Restart the instances. If the database is down, check the provider's status, then its failover. |
| Health is ok but pages fail after a release | The release's log, migration output | Roll back to the previous image. Migrations here only add; a rollback is safe. |
| Can't log in | Login throttle (`auth_attempts`), mail provider | A locked person waits 15 minutes; clear a single email's rows if it's you testing. |
| Emails to staff don't arrive | Resend dashboard, SPF/DKIM | Fix the domain records; the reset link can be re-requested. |
| Client emails don't send | The agency's Connectors page: "Needs reconnecting" | Ask the owner to reconnect Gmail or Microsoft. Messages wait in the Outbox and send on reconnect. |
| Wrong or missing data | Don't edit rows by hand. | Restore the database to a new instance from just before the problem (point-in-time), compare, then copy back only what's needed. |

**Tell affected customers within an hour of an outage**, even if you don't know the cause yet, and post it on the status page.

**Contacts to fill in:** backup person for support: ____. Technical contact who can restart and restore: ____. Hosting provider support: ____.

## What still isn't done

- Uploads on object storage.
- The container image and the release steps above are untested on a real host.
- Encryption key held in the vault (works today from an environment variable).
- A status page and its alerts.
- A nonce-based content security policy (today's allows inline scripts).
