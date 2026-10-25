# Stage 2 — Schema & Migrations Notes

## Migration tool

`backend/src/db/migrate.ts` — deliberately not node-pg-migrate/Prisma/Knex/etc. It's ~40 lines using `pg` (already a dependency): read `backend/migrations/*.sql` in filename order, skip anything already recorded in a `schema_migrations` table, run each remaining file in a transaction, record it. Same two commands (`npm run migrate`, `npm run seed`) work identically against dev/staging/prod — the only thing that changes is which `DATABASE_URL` is in the environment.

Trade-off taken deliberately: **no down-migrations**. At this stage every environment holds placeholder data only, so "undo" just means editing forward. This should be revisited before Stage 14 (production cutover) if a rollback path is ever needed against real customer data.

## Entity notes

- **`users` vs `admin_users`** — separate tables, not a `role` column on one table. Matches the PRD's "no super-admin layer": every `admin_users` row is a full admin, and there's no risk of an admin flag ever leaking into customer-facing queries.
- **`addresses.user_id` is nullable** — a guest checkout still needs a shipping address row to attach to an order; it just never gets reused across orders or shown in an account's saved-addresses list.
- **Variants are additive, not mandatory** (`products.has_variants` + a CHECK constraint):
  - `has_variants = false` → `products.stock` holds the count, `product_variants` has no rows for that product.
  - `has_variants = true` → `products.stock` is `NULL`, and each `product_variants` row carries its own `stock`, optional `price`/`discount_price` override (NULL = inherit the product's price), and a free-form `attributes` JSONB bag (`{"size": "500g", "flavour": "Chocolate"}`) so size/colour/model/capacity/pack-size are all the same mechanism instead of five nullable columns.
- **`inventory` is an audit ledger, not the live stock count.** Live stock is the denormalized `stock` column on `products`/`product_variants`, so a storefront page or a low-stock check is a plain column read — no aggregation needed. `inventory` records *why* that number changed (`initial`, `restock`, `sale`, `adjustment`, `return`) for Stage 9's admin view and any future dispute/audit need. A CHECK enforces exactly one of `product_id`/`product_variant_id` per row, matching whichever level that product tracks stock at.
- **Cart ownership is exclusive and DB-enforced.** A `carts` row has either `user_id` or `guest_token`, never both (CHECK), and a partial unique index allows at most one row with `status = 'active'` per user or per guest token. Stage 3's "associate guest cart with account on login" is implemented as flipping this same row's owner (converting any pre-existing active user cart to `'converted'` first) — never copying cart_items into a second row — which is what makes "one profile, one cart lineage" a database guarantee rather than an app-layer convention.
- **`cart_items` dedup uses a sentinel UUID.** Postgres treats `NULL <> NULL` in a plain `UNIQUE` constraint, so two "add to cart" calls for the same no-variant product (`product_variant_id IS NULL` both times) wouldn't collide under a naive unique constraint. The unique index coalesces `product_variant_id` to a fixed all-zero sentinel UUID instead, so the no-variant case dedupes correctly too.
- **`payments.(provider, provider_reference)` is unique** — this is the literal mechanism behind Stage 8's "a spoofed/duplicate webhook call is rejected" exit condition: replaying the same provider reference hits this constraint at the DB level, not just an app-side check that could be skipped by a retry racing itself.
- **`order_items` snapshots product name/price/variant attributes** rather than only pointing at `product_id`/`product_variant_id` (which are also kept, but as `ON DELETE SET NULL`). A later price edit, or the product/variant being deleted outright, must never rewrite what a past order shows the customer or admin.
- **Every `updated_at` column is maintained by a shared trigger** (`set_updated_at()`, migration 0001), not application code — no code path can forget to bump it.

## What I couldn't verify in this session

No network access and no local Postgres binary were available in this sandbox, so these migrations and the seed script are reviewed carefully but **not executed** here — unlike Stage 1, where the Fastify/Next.js apps were actually run. Before starting Stage 3:

1. Confirm the `migrations` job in `backend-ci.yml` (spins up a throwaway Postgres and runs `migrate` + `seed`) passes on GitHub.
2. Or run `npm run migrate && npm run seed` yourself against a scratch database / Railway's dev environment.

Either is sufficient proof; I'd treat Stage 2 as provisionally done until one of them goes green.
