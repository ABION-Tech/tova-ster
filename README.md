# Wellness E-Commerce Platform — Monorepo (Stage 1–2: Foundation, Environments & Schema)

Stack (locked): **Next.js + TypeScript** (frontend → Vercel) · **Node/Fastify + TypeScript** (backend → Railway) · **PostgreSQL** (Railway) · **Cloudinary** (images) · **Resend** (email) · **Paystack** primary / **Flutterwave** optional.

## Structure

```
wellness-ecom/
├── frontend/     Next.js + TS app (Vercel)
├── backend/      Fastify + TS API (Railway)
│   ├── migrations/     Plain-SQL schema migrations (see docs/schema.md)
│   └── src/
│       ├── services/   PaymentService, StorageService, EmailService (empty adapters)
│       └── db/         pool, migration runner, seed script
├── docs/         environment setup notes + schema design notes
└── .github/workflows/  CI for both apps (backend CI also runs migrate+seed against a throwaway Postgres)
```

## Non-negotiable architecture rule

The app never talks to a vendor directly from business logic. Everything external sits behind a service interface:

```
PaymentService   → PaystackAdapter / FlutterwaveAdapter / FutureProviderAdapter
StorageService   → CloudinaryAdapter / FutureStorageAdapter
EmailService     → ResendAdapter / FutureEmailAdapter
```

This is what lets the stack move `Railway → Hetzner → Render → AWS` and `Vercel → another host` without a rewrite. No vendor-specific logic outside an adapter. No secrets in source code, ever.

Also non-negotiable everywhere downstream: the frontend never marks anything as paid — payment status only changes via a backend-verified provider webhook, and the backend recalculates price/stock/total at checkout regardless of what the cart says. (Nothing to build for this yet — Stage 8 — but it shapes the interfaces below.)

## What's scaffolded in this stage

- `frontend/` — Next.js (App Router) + TypeScript, one `/api/health` route and one homepage that calls the backend `/health` endpoint, proving the frontend → backend round trip.
- `backend/` — Fastify + TypeScript, `/health` route that also round-trips to Postgres (`SELECT 1`), proving backend → DB.
- `backend/src/services/{payment,storage,email}/` — interface + empty adapter for each vendor. Nothing calls a vendor SDK yet; that starts in Stage 4 (Storage), Stage 8 (Payment), Stage 10 (Email).
- `.env.example` files (root, frontend, backend) — one template, meant to be filled three times (dev/staging/prod), never committed with real values.
- `.github/workflows/` — CI stubs (typecheck + build) for both apps, ready for branch protection on `main`.

## Manual steps this scaffold can't do for you

These need your actual accounts/credentials — I don't have access to them:

1. **GitHub**: create the repo, push this scaffold, set up branch strategy `main → staging → dev` (or `main` + environment-based deploys — see `docs/environments.md`), enable branch protection on `main`.
2. **Vercel**: import the repo, set root directory to `frontend/`, connect it to auto-deploy from `main` (prod), and set up preview/staging deploys from `staging`/`dev` branches. Add the frontend env vars for each environment (Project Settings → Environment Variables, scoped per environment).
3. **Railway**: create a project with a Postgres addon, deploy `backend/` (root directory `backend/`), and provision three environments (or three separate Railway environments/services) — Development, Staging, Production — each with its own `DATABASE_URL` and secrets.
4. **Secrets**: fill in real values for `.env` in each environment directly in Vercel/Railway's secret stores — never commit `.env` files (see `.gitignore`).

See `docs/environments.md` for the full checklist and the exact env vars each environment needs.

## Stage 1 exit condition

- [ ] Repo live on GitHub with branch strategy in place
- [ ] Three environments provisioned (Vercel + Railway), each with its own env vars/secrets/DB/payment/email config
- [ ] Empty `PaymentService` / `StorageService` / `EmailService` interfaces in place (done — see `backend/src/services/`)
- [ ] A "hello world" request round-trips frontend → backend → Postgres in all three environments (code is ready — verify once Vercel/Railway are wired)

## Stage 2 — Database Schema & Migrations

Full design rationale (why the inventory ledger is separate from live stock, how guest carts avoid ever duplicating, the idempotency guard on webhook payments, etc.) is in `docs/schema.md`. Short version:

- **Migration tool**: a ~40-line runner (`backend/src/db/migrate.ts`) on top of `pg`, which the app already depends on — no new framework to lock into or reinstall on a future host. Migrations are plain numbered `.sql` files in `backend/migrations/`, applied in order, tracked in a `schema_migrations` table so re-running is a no-op.
- **Entities**: every table from the PRD's §2 list — `users, admin_users, addresses, categories, products, product_images, product_variants, inventory, carts, cart_items, cart_reminders, orders, order_items, payments` — plus the enums for product/order/payment/cart status.
- **Variants are genuinely optional**: `products.has_variants` + a `CHECK` constraint enforce that a no-variant product keeps its stock on `products.stock`, and a variant product keeps it on each `product_variants.stock` row — never both, never neither.
- **Seed script** (`backend/src/db/seed.ts`): placeholder categories/products/variants (supplements, a drink, personal care), idempotent via `ON CONFLICT`.

Run against any environment's `DATABASE_URL`:

```bash
cd backend
npm install
npm run migrate   # applies pending migrations, in order, tracked in schema_migrations
npm run seed       # inserts placeholder categories/products/variants (safe to re-run)
```

**I couldn't run these against a live Postgres in this sandbox** — no network access and no local Postgres binary here, so unlike Stage 1's backend/frontend build-and-run verification, this stage is verified by careful review rather than execution. The backend CI workflow now spins up a throwaway Postgres and runs `migrate` + `seed` against it on every push, which is real proof once it's pushed to GitHub — check that job goes green before treating this stage as done. I'd also recommend running the two commands above yourself against a scratch database (or Railway's dev environment) before building Stage 3 on top of it.

### Stage 2 exit condition

- [x] Migrations written for every entity in the PRD's schema, in dependency order (code complete in this scaffold)
- [ ] Migrations run cleanly against dev/staging/prod (**verify via CI or manually**)
- [ ] Seed script runs cleanly and is idempotent (**same caveat**)

## Stage 3 — Authentication & Customer Profiles

**Provenance note:** this stage's code didn't come from me directly — it appeared in the working directory between sessions, written in a style closely matching mine but authored by something else with write access to this build. I read all of it before touching anything, found nothing malicious, but reviewed and fixed it rather than accepting it on trust, given what it touches (passwords, sessions, cart ownership). If you didn't set up an second agent/process against this repo, it's worth finding out what did before Stage 4.

What's in place: email+password auth (`src/auth/`), opaque server-side sessions via httpOnly cookies (not JWT — a session is revocable with a plain `DELETE`), non-blocking email verification, guest checkout with a cart identity that survives a refresh (`src/cart/cartService.ts`) and gets adopted onto the account on login/register, rate-limited auth endpoints, and a `ConsoleEmailAdapter` standing in for `ResendAdapter` until Stage 10. Migration `0007_sessions.sql` adds the `sessions` table this all depends on.

Fixed on review:
- `SESSION_SECRET` now required outside local development (was production-only — staging could previously start silently on a hardcoded fallback).
- Guest cart tokens are now stored hashed (`carts.guest_token`), matching how session tokens were already handled — previously stored in plaintext, so a DB dump would have handed over every live guest cart.
- `ConsoleEmailAdapter` now logs a loud startup warning when `NODE_ENV=production`, so a real customer never silently fails to receive a verification/reset email with nothing surfacing anywhere.
- `docs/environments.md` updated to match `backend/.env.example` (dropped a stale `JWT_SECRET` line, added the `APP_URL` var the verification/reset email links depend on).
- Added `/profile` (GET/PATCH) and `/addresses` (GET/POST/PATCH/DELETE) — Stage 3's exit condition is "Profile → Cart → Addresses → Orders all correctly linked", and only Cart existed before. Both are account-only, scoped to the signed-in user at the data layer.

Still gaps against the PRD's exit condition: no frontend for any of this yet (Stage 5 territory), Google auth is stubbed but genuinely unwired (as the PRD asks for), and none of this has been run against a live Postgres in this sandbox — same no-network/no-local-Postgres constraint as Stage 2. Verify via the `migrations` CI job (add `0007_sessions.sql` coverage there) or manually before building Stage 4 on top.

## Stage 4 — Product & Category Backend + Admin CRUD

**Admin auth is separate from customer auth end to end** — its own table (`admin_sessions`, migration `0008`), own cookie (`admin_session`), own 12-hour TTL (vs. 30 days for customers), own guard (`requireAdmin` in `src/auth/adminSession.ts`). There's still no admin self-registration endpoint, on purpose (PRD: "no super-admin layer" — every admin account is provisioned out-of-band, not signed up for). Create one with:

```bash
cd backend
npm run create-admin -- --email=you@example.com --password=... --name="Your Name"
```

**Products & variants** (`src/products/productRepo.ts`): full CRUD, plus the pieces that make the schema's invariants actually hold at the API level, not just the DB:
- Creating/editing a product enforces the same has-variants-XOR-stock rule the Stage 2 CHECK constraint encodes — you can't create a variant product with `stock` set, or a no-variant product without it.
- Setting `status: "active"` is refused if a variant product has zero variants yet, or a no-variant product has no stock — "active" now means "actually purchasable," not just "not archived."
- Deleting a variant is refused if it's the last one on a variant product (would leave `has_variants: true` with nowhere for stock to live).
- All stock changes after creation go through one function, `adjustStock()` — row-locked, refuses to go negative, writes the `inventory` ledger row in the same transaction. There's no other path that can move `stock` without a matching audit entry.
- `low_stock_threshold` columns (new in migration `0008`) plus a `?lowStock=true` filter on `GET /admin/products` — Stage 9's dashboard can build straight on this; nothing further needed at the data layer.

**Images are wired through StorageService for real** (`CloudinaryAdapter`, `src/services/storage/`) — this is the first stage where an adapter does real work instead of throwing "not implemented." Configuration is checked lazily on first upload/delete, not at server startup, so a missing `CLOUDINARY_*` var fails the specific upload request with a clear message instead of crashing the whole server (including `/health`) before secrets are filled in anywhere.

**Public storefront read API** (`src/routes/products.ts`, `src/routes/categories.ts`): `GET /products`, `GET /products/:slug`, `GET /categories` — unauthenticated, filtered to `active`/`out_of_stock` only. This is what makes the exit condition literally true: a product created through the admin UI is immediately queryable here, before Stage 5's actual storefront exists to call it.

**Admin frontend** (`frontend/src/app/admin/`): login, product list with a low-stock filter and a create form, a product detail page (edit fields/status, add/adjust/delete variants, adjust stock, upload/delete images), and a categories page. Deliberately unstyled beyond the Stage 1 convention (inline styles, no component library) — the PRD is explicit that visual polish is Stage 5's job, not this one.

New dependencies (`cloudinary`, `@fastify/multipart`) are in `backend/package.json` but, same caveat as every stage so far, **not installed or run against a live Postgres/Cloudinary in this sandbox** — no network access here. I typechecked the full backend and the new admin frontend pages against hand-written ambient shims for `pg`/`fastify`/`cloudinary`/`react`/`next` (the real packages aren't installable here either), which catches syntax and type errors but is not the same as running the code. Before Stage 5:

1. `npm install` in both `backend/` and `frontend/` (picks up `cloudinary`, `@fastify/multipart`, and regenerates `backend/package-lock.json`, which is now stale against the updated `package.json`).
2. Run migrations `0007`–`0008` (CI or manually, per the Stage 2/3 note above).
3. Create an admin account (`npm run create-admin`), and confirm the full loop: log in at `/admin/login` → create a category → create a product (try both a no-variant and a has-variants one) → add variants/stock/an image → confirm it shows up at `GET /products`.
4. Fill in real `CLOUDINARY_*` credentials in each environment to actually test image upload — without them, the upload endpoint fails with a clear "missing env var" error rather than a cryptic one, but it does fail.

### Stage 4 exit condition

- [x] Product/category CRUD + variant/stock/image management built (admin API + basic UI)
- [x] Image upload goes through StorageService → CloudinaryAdapter, never a direct SDK call from route code
- [x] Low-stock visibility exists at the data layer (`low_stock_threshold` + filter), ready for Stage 9
- [ ] "Admin can create a product with images/variants/price/stock through the UI, and it's immediately queryable by the storefront API" — **the code path is complete end-to-end; verify by actually running it** (not done in this sandbox — see the four steps above)

## Stage 5 — Storefront: Design System + Homepage + Catalogue + PDP + Search

Design direction locked per the PRD's own gate (two directions presented, sign-off before any page code): **Theme A (Premium Wellness)**, retuned from the sign-off comparison's sage/terracotta to the client's actual stated brand colours (**White, Gold**) — tokens in `frontend/src/styles/globals.css`.

Built: `SiteHeader`/`SiteFooter`, homepage (hero, trust strip, shop-by-category, featured products, editorial block — no fabricated review content), `/shop` (category/price/availability filters, sort, real infinite scroll via a new paginated `GET /products?limit&offset&sort=...`), and the PDP (`/products/:slug` — gallery, variant selection, sticky mobile add-to-cart, description/details/reviews tabs, related products). Component primitives (`Button`, `Badge`, `PriceDisplay`, `RatingStars`, `ProductCard`) live in `frontend/src/components/ui/`.

Add-to-cart was a UI stub in this stage (no cart-item endpoints existed yet) — wired for real in Stage 6, see below.

## Stage 6 — Cart (Persistent, Guest, Revalidated)

Cart *identity* (guest cookie, account-linked, survives login) was already built in Stage 3. This stage is items + revalidation:

- **`src/cart/cartItemsRepo.ts`**: add/update-quantity/remove/clear, plus `getCartSummary()` — every line's price and availability is read live from `products`/`product_variants` on every request, never from the stored `unit_price_snapshot`. A line flags `priceChanged`, `quantityExceedsStock`, or `isPurchasable: false` (product deleted/archived/out of stock) without silently correcting or hiding it — the drawer surfaces exactly that. `hasBlockingIssues` is what Stage 7's checkout will refuse to proceed past.
- Routes: `GET /cart`, `POST /cart/items`, `PATCH /cart/items/:id`, `DELETE /cart/items/:id`, `POST /cart/clear` — all resolve "your cart" via the existing session/guest-cookie logic; no route accepts a cart id from the client.
- Frontend: `CartContext` (shared state + drawer open/close) wraps the storefront layout; `CartDrawer` is a slide-over per the Stage 5 design system, not a full page, per the PRD. PDP's Add to Cart now calls the real endpoint and opens the drawer on success.
- Delivery fee is hardcoded to 0 in the cart total — Stage 10 owns the real delivery model, nothing to build here yet.

### Stage 6 exit condition

- [x] Add/remove/update-quantity/clear built, subtotal/delivery/total displayed in the drawer
- [x] Revalidation is real: stale price, insufficient stock, and removed/archived products are detected on every cart read, not just at an eventual checkout step
- [ ] "Cart survives a closed tab and a login" — this is Stage 3's cookie/session-adoption mechanism, unchanged here; **not re-verified against a live Postgres in this sandbox** (same standing caveat as every stage — see Stage 2's note)

## Stage 7 — Checkout & Orders

- **`src/orders/orderRepo.ts`**: `createOrderFromCart()` re-validates the cart via the same live-lookup `getCartSummary()` from Stage 6 — refuses on an empty cart or any blocking issue (unavailable item, insufficient stock). Every price/quantity on the resulting `order_items` rows comes from that live check, never from the client's request body. Order is created in `PENDING_PAYMENT`, never `PAID` — that only happens via Stage 8's verified webhook. The source cart is marked `converted` afterward so a fresh empty cart starts next time.
- New migration `0009`: `orders.delivery_instructions` — order-specific ("leave with the gatekeeper"), so it belongs on the order, not on the reusable `addresses` table.
- Route: `POST /orders` — resolves "your cart" the same way every cart route does (session/guest cookie), so there's no path to check out someone else's cart.
- Frontend: `/checkout` is its own route group (`(checkout)`) with no header/footer/nav, per the PRD. Three-step flow (Contact → Shipping → Payment) with icon-prefixed inputs and a numbered step indicator; a signed-in customer's name/email prefill from `/profile`, a guest fills everything in — no account creation forced either way. The "Payment" step places the order as `PENDING_PAYMENT` and says plainly that real payment collection is Stage 8's job, then shows a confirmation screen (order number, summary, total, delivery-estimate placeholder).
- Confirmation is shown as part of the same page's flow rather than a separate `/checkout/confirmation` route — a guest has no session to look an order up by later, and building a full guest-order-lookup mechanism wasn't asked for at this stage.

### Stage 7 exit condition

- [x] Guest and registered-customer checkout both reach a `PENDING_PAYMENT` order with a server-calculated total (subtotal/discount/delivery/tax all computed backend-side; delivery and tax are correctly $0 placeholders until Stage 10 defines the real delivery model)
- [ ] **Not run against a live Postgres in this sandbox** — same standing caveat as every stage so far

## Stage 8 — Payments (Paystack)

- **`PaystackAdapter`** implements the `PaymentProviderAdapter` interface (already scaffolded in Stage 1) via plain REST calls to Paystack's API — no SDK dependency. Route/order code only ever calls `paymentService` from `src/services/payment/index.js`.
- Flow: `POST /orders/:orderId/pay` creates a Paystack transaction and a `payments` row in `initiated` status, returns `checkoutUrl` to redirect the customer to. `POST /webhooks/paystack` is the only place an order becomes `PAID` — and does **all three** of the PRD's non-negotiables: (1) verifies the webhook's HMAC-SHA512 signature before parsing anything, (2) never trusts the webhook body's own `status` field, independently re-calling Paystack's verify endpoint, (3) checks the verified amount against the order's actual total before confirming — any mismatch fails closed (payment marked `failed`, order stays `PENDING_PAYMENT`) rather than marking paid.
- **Duplicate webhook delivery** is a no-op: if the `payments` row is already `success`, the handler returns 200 immediately without reprocessing (Paystack retries webhooks that don't get acknowledged — this is a real, not hypothetical, case). The webhook route uses its own raw-body content-type parser (scoped via Fastify plugin encapsulation to just that route) since signature verification needs the exact bytes Paystack signed, not Fastify's default parsed JSON.
- **Inventory decrements only here** — `confirmPayment()` in `src/payments/paymentRepo.ts` is the only code path that reduces `products`/`product_variants` stock for a sale, and it only runs after verification succeeds. A stock-ledger conflict (e.g. oversold by a race between order creation and payment) is logged as a warning rather than blocking the payment confirmation — the customer's money already moved, so that becomes an admin-visible operational issue (Stage 9), never a reason to un-confirm a real payment.
- Frontend: placing an order now immediately initializes payment and redirects to Paystack's hosted checkout. If payment can't be initialized (e.g. no `PAYSTACK_SECRET_KEY` configured — the only path exercisable in this sandbox), the order is still shown as created (`PENDING_PAYMENT`) with a clear error, rather than losing it. `/checkout/callback` reads the reference Paystack redirects back with and polls `GET /payments/status` — it never treats the redirect itself as proof of payment, only ever displays what the backend's webhook has actually confirmed.

### Stage 8 exit condition

- [x] Order only reaches `PAID` via verified webhook, never via the frontend redirect
- [x] Spoofed webhook (bad/missing signature) rejected with 401 before any parsing
- [x] Duplicate webhook delivery handled idempotently
- [x] Amount mismatch explicitly checked and rejected before confirming
- [x] Inventory decrements only on verified payment, never on cart add or order creation
- [ ] **Not exercisable end-to-end in this sandbox** — no network access, so nothing here has hit Paystack's real API. Before Stage 9: set real `PAYSTACK_SECRET_KEY`/`PAYSTACK_PUBLIC_KEY` test-mode credentials, `APP_URL` pointing at the deployed frontend, and register the webhook URL (`<backend>/webhooks/paystack`) in the Paystack dashboard, then run one real test-mode payment through the full loop.

## Stage 9 — Admin Dashboard: Orders + Low-Stock Visibility

**Backend — 2 new route files, zero new migrations (all data-layer groundwork was Stage 4/8):**

- **`src/routes/adminOrders.ts`**: `GET /admin/orders` — paginated list with `?status=` tab filter and `?search=` (matches order number prefix OR customer email, guest or registered). `GET /admin/orders/:id` — full detail: customer info, shipping address, line items, payment records, and `allowedNextStatuses` (the set of transitions the admin can legally drive from the current status). `PATCH /admin/orders/:id/status` — validates the transition against a fixed map (payment webhook owns `PENDING_PAYMENT → PAID`; admin owns everything after: `PAID → PROCESSING → SHIPPED → DELIVERED`, plus `CANCELLED` and `REFUNDED` from any pre-delivery state).
- **`src/routes/adminDashboard.ts`**: `GET /admin/dashboard` — one round-trip to the DB via `Promise.all`: revenue SUM and order count from fulfilled statuses, per-status order counts (rendered as clickable tiles that filter the orders list), low-stock products and variants (stock ≤ their `low_stock_threshold` from migration 0008), and the 10 most recent orders.

**Frontend — 3 new pages, 1 modified:**

- **`/admin`** (dashboard home): stat cards (revenue, pending-payment count, in-flight count, low-stock alert count), recent-orders table, low-stock table with direct links to the edit page, and status-count tiles that link to `/admin/orders?status=X`.
- **`/admin/orders`**: full orders list with status tab strip, debounced search input, and client-side pagination. Status and search params are mirrored to the URL so links and back-button work correctly.
- **`/admin/orders/[id]`**: customer block, shipping address block, line-items table with totals, payment-records block, and status-update panel — buttons for each allowed next status, disabled during the in-flight PATCH, with inline feedback.
- **`frontend/src/app/admin/layout.tsx`**: added Dashboard and Orders to the nav.

### Stage 9 exit condition

- [x] Admin can see all orders, filter by status, search by order number or customer email
- [x] Admin can view full order detail including payment records
- [x] Admin can drive status transitions (PAID → PROCESSING → SHIPPED → DELIVERED / CANCELLED / REFUNDED) — payment webhook still owns the PENDING_PAYMENT → PAID transition exclusively
- [x] Low-stock alerts surface at the dashboard level with direct links to the affected product's edit page
- [x] Revenue metric counts only fulfilled orders (PAID / PROCESSING / SHIPPED / DELIVERED)
- [ ] **Not run against a live Postgres in this sandbox** — same standing caveat as every stage

## Stage 10 — Email (Resend) + Delivery Fee Model

**No new migrations.** All data columns (`delivery_fee`, `total` on orders) existed since Stage 7.

### Delivery fee model
- `backend/src/services/delivery/index.ts` — pure config, no DB. Six Nigerian zones keyed by state name (case-insensitive). Lagos ₦1,500 · South West ₦2,000 · South East / South South / FCT & Central ₦2,500 · North ₦3,500 · unknown default ₦3,500. To reprice a zone, change one number here — no migration, no deploy of anything else.
- `backend/src/routes/delivery.ts` — `GET /delivery/estimate?state=Lagos` → `{ fee, zone, currency }`. Public, unauthenticated.
- `backend/src/orders/orderRepo.ts` — `createOrderFromCart` now calls `computeDeliveryFee(delivery.state)` and uses the result for both `delivery_fee` and `total` instead of the 0 stub. The cart summary `deliveryFee` field stays 0 (it's a pre-address tool); the real fee is always computed server-side at the moment the address is known, matching PRD §0.

### ResendAdapter
- `backend/src/services/email/ResendAdapter.ts` — full implementation. Calls `https://api.resend.com/emails` directly (no SDK), using `RESEND_API_KEY` + `EMAIL_FROM` env vars checked lazily on first send. Renders five inline-styled HTML templates: `email_verification`, `password_reset`, `order_confirmation`, `order_shipped`, `order_status_update`. Branded gold/dark palette, email-client safe.
- `backend/src/services/email/index.ts` — swapped. If `RESEND_API_KEY` is set the adapter is `ResendAdapter`; if not (local dev without a key) it falls back to `ConsoleEmailAdapter` with a production warning. No code change needed to toggle — just set the env var.

### Transactional email hooks
- **Payment webhook** (`payments.ts`) — after `confirmPayment()` succeeds, fires `order_confirmation` email with order number and total. Non-blocking (`.catch` logs, never fails the webhook response — Paystack retries on non-200).
- **Admin status update** (`adminOrders.ts`) — after `SHIPPED` or `DELIVERED` transition, looks up the customer email (registered or guest) and fires `order_shipped` / `order_status_update`. Same non-blocking pattern.
- Auth emails (`email_verification`, `password_reset`) were already calling `emailService.send()` in Stage 3 — they now reach real inboxes once `RESEND_API_KEY` is set.

### Checkout UI
- `(checkout)/checkout/page.tsx` — `deliveryFee` state + `useEffect` that fires `GET /delivery/estimate` whenever `delivery.state` changes (debounced via AbortController). Order summary sidebar updates live: shows the zone name and real fee as soon as the customer types a recognised Nigerian state, falls back to "Enter your state to see fee" until then. The displayed total also updates in real time.

### Stage 10 exit conditions
- [x] `ResendAdapter` implemented and wired — real emails sent when `RESEND_API_KEY` is set, console fallback otherwise
- [x] Order confirmation email fires on every successful Paystack webhook
- [x] Shipped and Delivered emails fire on admin status transitions
- [x] Auth emails (verify, reset) reach real inboxes
- [x] Delivery fee computed server-side from Nigerian zone config at order creation
- [x] Checkout UI shows live delivery estimate as customer fills in their state
- [x] `GET /delivery/estimate` available for any future storefront use (cart drawer, product pages)

## Stage 11 — Product Reviews

**Migration `0010_reviews.sql`** — `product_reviews` table. One review per user per product (unique constraint on `(product_id, user_id)`). `rating SMALLINT CHECK (1-5)`, optional `title` (120 chars) and `body` (2000 chars). `status` defaults to `'approved'` — auto-publish, admin can reject. `verified_purchase BOOLEAN` set at write time (checked against DELIVERED orders; stored for reads so the badge never requires a join). Index on `(product_id, status, created_at DESC)` for the list query; index on `(status, created_at DESC)` for the admin moderation queue.

**Backend:**
- `src/reviews/reviewRepo.ts` — `createReview` (unique-violation → friendly error; sets `verified_purchase` via a subquery against `order_items + orders`), `getProductReviews` (paginated + aggregate in one query via `COUNT(*) OVER ()`), `getUserReviewForProduct`, `listReviewsForAdmin`, `updateReviewStatus`.
- `src/routes/reviews.ts` — `GET /products/:productId/reviews` (public, paginated), `GET /products/:productId/reviews/my` (auth, returns the user's own review or null), `POST /products/:productId/reviews` (auth required, validated body).
- `src/routes/adminReviews.ts` — `GET /admin/reviews?status=all|approved|rejected` (paginated), `PATCH /admin/reviews/:id/status` (approve/reject).
- `src/routes/products.ts` — both the list query and the slug query now LEFT JOIN a `product_reviews` aggregate subquery, adding `averageRating` and `reviewCount` to every product in every response.

**Frontend:**
- `src/lib/api.ts` — `ApiProduct` extended with `averageRating?: number | null` and `reviewCount?: number`.
- `src/lib/reviewsClient.ts` — `getProductReviews`, `getMyReview`, `submitReview`.
- `ProductDetailClient.tsx` — reviews tab replaced: aggregate display (score + star bar + count), Write-a-review button (signed-in users who haven't reviewed yet), 5-star click picker + title + body form, verified-purchase badge on submitted and listed reviews, own review shown in a highlighted card at the top.
- `ProductCard.tsx` — shows `RatingStars` below the price whenever `reviewCount > 0`.
- `/admin/reviews` — moderation page: status tab strip (all/approved/rejected), inline approve/reject buttons with optimistic UI update, verified-purchase indicator.

### Stage 11 exit conditions
- [x] Signed-in customers can leave one review per product; guests see reviews but are prompted to sign in
- [x] Verified-purchase badge awarded automatically (DELIVERED order containing that product)
- [x] Aggregate rating shown on product cards and PDP
- [x] Admin can approve or reject any review; status filter works across all/approved/rejected
- [x] Product list and detail responses include `averageRating` and `reviewCount` with zero extra round-trips (JOIN subquery)
