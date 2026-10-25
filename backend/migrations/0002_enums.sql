-- Product lifecycle state (§4 Locked Scope / Stage 4).
CREATE TYPE product_status AS ENUM ('active', 'out_of_stock', 'draft', 'archived');

-- Order status lifecycle, verbatim from the PRD (§2).
CREATE TYPE order_status AS ENUM (
  'PENDING_PAYMENT', 'PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED',
  'CANCELLED', 'REFUNDED'
);

-- Payment provider — Paystack is the active adapter (Stage 8), Flutterwave
-- stubbed for future activation. Adding a third provider later is a new
-- enum value, not a schema redesign.
CREATE TYPE payment_provider AS ENUM ('paystack', 'flutterwave');

-- Payment record status. Distinct from order_status: a payment can fail or
-- be cancelled without ever having existed as a paid order.
CREATE TYPE payment_status AS ENUM ('initiated', 'pending', 'success', 'failed', 'cancelled');

CREATE TYPE cart_status AS ENUM ('active', 'converted', 'abandoned', 'expired');

-- Audit trail entry types for the inventory ledger (see 0004).
CREATE TYPE inventory_change_type AS ENUM ('initial', 'restock', 'sale', 'adjustment', 'return');

-- Abandoned-cart reminder sequence (Stage 11): Day 1 -> Day 3 -> Day 7 -> Day 30.
CREATE TYPE cart_reminder_step AS ENUM ('day_1', 'day_3', 'day_7', 'day_30');
CREATE TYPE cart_reminder_status AS ENUM ('scheduled', 'sent', 'cancelled');
