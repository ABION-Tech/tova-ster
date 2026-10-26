# Deploying Tova-Ster: Supabase, Railway, Vercel, GitHub

| Piece | Where | What it runs |
|---|---|---|
| Code | GitHub (private repo) | Everything in this folder. Pushing to `main` deploys. |
| Database | Supabase (region: London, eu-west-2) | Postgres 15+. Our own migrations create every table. |
| Server (API) | Railway, service root `backend/` | Fastify server, daily jobs, Stripe webhooks. |
| Shop and admin | Vercel, project root `frontend/` | Next.js storefront and admin. |
| Client demo | Vercel, separate project, root `demo/` | The static demo (noindex). |

Addresses: `tova-ster.com` (Vercel), `api.tova-ster.com` (Railway), `demo.tova-ster.com` (Vercel).
Keeping shop and API on the same domain matters: Safari blocks sign-in cookies
between unrelated domains (for example `*.vercel.app` and `*.up.railway.app`).

## 1. GitHub
1. Create a private repo, e.g. `tova-ster/shop`, with branches `main` (live) and `staging`.
2. Push this folder. CI in `.github/workflows` type-checks, builds and runs every migration on a fresh Postgres.

## 2. Supabase (database)
1. New project, region **London (eu-west-2)**, strong database password saved in a password manager.
2. Project Settings › Database › Connection string: copy the **Session pooler** URI
   (`postgres://postgres.<ref>:<password>@aws-0-eu-west-2.pooler.supabase.com:5432/postgres`).
   Use session mode, not transaction mode (port 6543). The direct `db.<ref>.supabase.co` address is IPv6-only.
3. Project Settings › Data API: remove `public` from exposed schemas (or switch the Data API off).
   Migration 0020 also turns on row level security for every table, so the public `anon` key sees nothing even if the API stays on.
4. Database › Backups: daily backups are included on the Pro plan; Point-in-time recovery is an add-on.
   `backend/scripts/backup/backup.sh` still works against Supabase for an off-site copy.

## 3. Railway (server)
1. New project › Deploy from GitHub repo › set **Root Directory** to `backend`. Service settings:
   build `npm ci && npm run build`, start `npm start`, healthcheck `/health`, watch paths `/backend/**`,
   pre-deploy `npm run migrate:prod && if [ "$SEED_ON_DEPLOY" = "true" ]; then node dist/db/seed.js; fi`
   (set `SEED_ON_DEPLOY=true` for the first deploy only, then delete it).
2. Variables (Service › Variables):

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Supabase session pooler URI |
| `SESSION_SECRET` | 64 random characters |
| `APP_URL` | `https://tova-ster.com` |
| `CORS_ORIGIN` | `https://tova-ster.com` |
| `PAYMENT_PROVIDER` | `stripe` |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | from Stripe (live) |
| `RESEND_API_KEY`, `EMAIL_FROM` | from Resend; `Tova-Ster <info@tova-ster.com>` |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | from Cloudinary |
| `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_REDIRECT_URI` | from Meta; redirect `https://api.tova-ster.com/instagram/oauth/callback` |

3. Settings › Networking › Custom domain `api.tova-ster.com` (add the CNAME it shows at the DNS host).
4. After the first deploy, create the first Owner with a one-time password link (48 hours):
   `node dist/db/createAdmin.js --invite --email=owner@example.com --name="Owner Name"`.
   Everyone else is invited from Admin › Team, which only the Owner sees.
5. Stripe webhook endpoint: `https://api.tova-ster.com/webhooks/stripe`.

## 4. Vercel (shop and admin)
1. Add New › Project › import the GitHub repo › **Root Directory** `frontend` (Next.js is detected).
2. Environment variables: `NEXT_PUBLIC_BACKEND_URL=https://api.tova-ster.com`, `NEXT_PUBLIC_SITE_URL=https://tova-ster.com`.
3. Domains: `tova-ster.com`, plus `www.tova-ster.com` and `tova-ster.co.uk` redirecting to it.
4. Demo: a second project from the same repo with Root Directory `demo` (no build step), domain `demo.tova-ster.com`.

## 5. Staging
Same three pieces again from the `staging` branch: a second Supabase project, a Railway environment, and Vercel preview deployments, all with Stripe test keys. See `staging-and-backups.md`.
