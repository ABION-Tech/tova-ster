# Staging and backups

## Staging (a private copy for testing before changes go live)

Staging is a second, separate copy of the shop: its own server, database and test keys, so changes can be tried
without touching real customers or real money. Set it up once the client's Railway account exists.

1. In Railway, create a second environment called `staging` in the same project (Project → Environments → New).
   It gets its own Postgres database.
2. Copy `backend/.env.staging.example` into the staging environment's variables and fill in the blanks.
   Use **Stripe test keys** and a **separate test webhook** (`https://<staging-api>/webhooks/stripe`).
3. Deploy the backend to staging, then run `npm run migrate` and `npm run seed` there.
4. In Vercel, add a Preview deployment (or a second project) for the shop, with
   `NEXT_PUBLIC_BACKEND_URL` set to the staging API address. Keep it behind Vercel's password protection.
5. Rule of thumb: every change goes to staging first; after a test order there, it is promoted to production.

Staging never sends marketing emails to real customers: leave `RESEND_API_KEY` empty (emails are only logged)
or use a Resend test domain.

## Backups (daily, with a tested restore)

- `backend/scripts/backup/backup.sh` writes a compressed dump of the whole database with a checksum, and deletes
  dumps older than `KEEP_DAYS` (default 14).
- `backend/scripts/backup/restore-check.sh` restores the newest dump into an **empty scratch database** and compares
  row counts of the key tables with the live database. It refuses to run against the live database and stops if
  the checksum does not match.

On Railway:
1. Turn on Railway's own Postgres backups (database service → Backups) if the plan includes them.
2. Also add a **cron service** from this repo that runs `bash scripts/backup/backup.sh` once a day (for example
   `0 3 * * *`, 3am UTC) with `DATABASE_URL` and `BACKUP_DIR` pointing at a mounted volume.
3. Once a month, create an empty database and run `restore-check.sh` against it. Write the date in the tracker.

Tested locally on 25 Oct 2026: backup 132 KB; restore matched all 11 key tables; a damaged file was refused.
