# Environments

Three environments, each fully isolated: own DB, own secrets, own payment credentials (test-mode for dev/staging, live for prod only), own email config.

| Environment | Branch     | Frontend (Vercel)       | Backend (Railway)        | DB              | Payment creds     |
|-------------|-----------|--------------------------|---------------------------|-----------------|--------------------|
| Development | `dev`      | Preview deploy           | Railway dev service        | Railway dev PG  | Paystack test keys |
| Staging     | `staging`  | Preview/staging deploy   | Railway staging service    | Railway staging PG | Paystack test keys |
| Production  | `main`     | Production deploy        | Railway prod service       | Railway prod PG | Paystack **live** keys |

## Branch strategy

```
main      → production (protected, PRs only, required checks)
staging   → staging (auto-deploy on merge)
dev       → development (auto-deploy on push)
```

## Env vars (fill per environment — never commit real values)

### `backend/.env`
```
NODE_ENV=development
PORT=4000
DATABASE_URL=postgres://...
CORS_ORIGIN=https://your-frontend-url
# Frontend base URL — used to build the links inside verification/reset emails.
APP_URL=https://your-frontend-url

# Payment (PaymentService)
PAYSTACK_SECRET_KEY=
PAYSTACK_PUBLIC_KEY=
FLUTTERWAVE_SECRET_KEY=

# Storage (StorageService)
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# Email (EmailService; ConsoleEmailAdapter logs instead of sending until Stage 10)
RESEND_API_KEY=
EMAIL_FROM=

# Auth (Stage 3) — sessions are opaque server-side tokens, not JWTs, so
# there's no JWT_SECRET. SESSION_SECRET is the HMAC key for session/
# verification/reset tokens — required in every environment except local
# development (the app refuses to start without it otherwise).
SESSION_SECRET=
```

### `frontend/.env.local`
```
NEXT_PUBLIC_BACKEND_URL=http://localhost:4000
NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY=
```

## Provisioning checklist

1. Railway: new project → add Postgres → deploy `backend/` → repeat (or use Railway environments) for dev/staging/prod → copy each `DATABASE_URL` into that environment's vars.
2. Vercel: import repo → root directory `frontend/` → set `NEXT_PUBLIC_BACKEND_URL` per environment to the matching Railway backend URL → connect `main`/`staging`/`dev` branches to their Vercel environments.
3. Confirm CORS: `backend` `CORS_ORIGIN` must match the exact Vercel URL for that environment.
4. Smoke test: hit `<frontend-url>` → it should call `<backend-url>/health` → which runs `SELECT 1` against that environment's Postgres → page shows "OK" for both frontend and backend/DB.
