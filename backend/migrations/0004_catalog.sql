CREATE TABLE categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id   UUID REFERENCES categories(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX categories_parent_id_idx ON categories (parent_id);

CREATE TRIGGER categories_set_updated_at
  BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A product is the sellable "thing" (e.g. "Omega-3 Fish Oil"). It always
-- carries its own base_price/stock/status; variants are optional on top of
-- that, not a replacement for it. has_variants + the CHECK below are what
-- let "a product with no variants just skips the relation" hold at the DB
-- level rather than being an app-layer convention someone can violate.
CREATE TABLE products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id     UUID REFERENCES categories(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  description     TEXT,
  base_price      NUMERIC(12, 2) NOT NULL CHECK (base_price >= 0),
  discount_price  NUMERIC(12, 2) CHECK (discount_price IS NULL OR discount_price >= 0),
  has_variants    BOOLEAN NOT NULL DEFAULT FALSE,
  -- Only meaningful when has_variants = FALSE. When a product has variants,
  -- stock lives on product_variants instead — this CHECK keeps stock from
  -- silently existing in two places at once.
  stock           INTEGER CHECK (stock IS NULL OR stock >= 0),
  status          product_status NOT NULL DEFAULT 'draft',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT discount_not_above_base CHECK (discount_price IS NULL OR discount_price <= base_price),
  CONSTRAINT stock_lives_in_one_place CHECK (
    (has_variants = TRUE AND stock IS NULL) OR
    (has_variants = FALSE AND stock IS NOT NULL)
  )
);

CREATE INDEX products_category_id_idx ON products (category_id);
CREATE INDEX products_status_idx ON products (status);

CREATE TRIGGER products_set_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Variants cover size/colour/model/capacity/pack-size etc. via a free-form
-- `attributes` bag rather than a fixed set of columns, since the client's
-- real catalogue (wellness, supplements, drinks, general goods) isn't
-- locked yet. price/discount_price are overrides: NULL means "use the
-- parent product's price" so simple variants (e.g. colour-only) don't need
-- to duplicate the base price.
CREATE TABLE product_variants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku             TEXT NOT NULL UNIQUE,
  attributes      JSONB NOT NULL DEFAULT '{}'::JSONB,
  price           NUMERIC(12, 2) CHECK (price IS NULL OR price >= 0),
  discount_price  NUMERIC(12, 2) CHECK (discount_price IS NULL OR discount_price >= 0),
  stock           INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  image_url       TEXT,
  status          product_status NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT variant_discount_not_above_price CHECK (
    discount_price IS NULL OR price IS NULL OR discount_price <= price
  ),
  -- Same attribute combo twice on one product is a data-entry bug, not a
  -- new variant.
  CONSTRAINT product_variant_attributes_unique UNIQUE (product_id, attributes)
);

CREATE INDEX product_variants_product_id_idx ON product_variants (product_id);

CREATE TRIGGER product_variants_set_updated_at
  BEFORE UPDATE ON product_variants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Images hang off a product, and optionally off one specific variant
-- (e.g. the "Blue" variant's own photo). Wired through StorageService ->
-- CloudinaryAdapter starting Stage 4 — this table just stores the resulting
-- URL, never a vendor-specific reference.
CREATE TABLE product_images (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id         UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_variant_id UUID REFERENCES product_variants(id) ON DELETE CASCADE,
  url                TEXT NOT NULL,
  alt_text           TEXT,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  is_primary         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX product_images_product_id_idx ON product_images (product_id);
CREATE INDEX product_images_variant_id_idx ON product_images (product_variant_id);

-- Inventory is an append-only ledger, not the live stock count. Live stock
-- is the denormalized `stock` column on products/product_variants (so
-- storefront reads and low-stock checks stay a single-column lookup, no
-- aggregation on every page view); this table is the audit trail of *why*
-- that number changed, which Stage 9's admin dashboard and Stage 8's
-- checkout flow both write to. Exactly one of product_id/product_variant_id
-- is set, matching whichever level that particular product tracks stock at.
CREATE TABLE inventory (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id         UUID REFERENCES products(id) ON DELETE CASCADE,
  product_variant_id UUID REFERENCES product_variants(id) ON DELETE CASCADE,
  change_type        inventory_change_type NOT NULL,
  quantity_delta     INTEGER NOT NULL,
  quantity_after     INTEGER NOT NULL CHECK (quantity_after >= 0),
  note               TEXT,
  created_by         UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inventory_exactly_one_target CHECK (
    (product_id IS NOT NULL AND product_variant_id IS NULL) OR
    (product_id IS NULL AND product_variant_id IS NOT NULL)
  )
);

CREATE INDEX inventory_product_id_idx ON inventory (product_id);
CREATE INDEX inventory_variant_id_idx ON inventory (product_variant_id);
CREATE INDEX inventory_created_at_idx ON inventory (created_at DESC);
