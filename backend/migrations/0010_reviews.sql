-- Stage 11: Product reviews
-- One review per user per product; auto-approved (admin can reject).
-- verified_purchase is set at write time — did this user receive a DELIVERED
-- order containing this product? Checked in reviewRepo, stored here for reads.

CREATE TABLE product_reviews (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       UUID        NOT NULL REFERENCES products(id)  ON DELETE CASCADE,
  user_id          UUID        NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  rating           SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title            VARCHAR(120),
  body             TEXT,
  status           TEXT        NOT NULL DEFAULT 'approved'
                               CHECK (status IN ('approved', 'rejected')),
  verified_purchase BOOLEAN    NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (product_id, user_id)
);

-- Primary read path: all approved reviews for a product.
CREATE INDEX product_reviews_product_status
  ON product_reviews (product_id, status, created_at DESC);

-- Admin moderation queue: pending reviews across all products.
CREATE INDEX product_reviews_status
  ON product_reviews (status, created_at DESC);
