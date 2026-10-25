import { pool } from "../db/pool.js";

export class ReviewError extends Error {}

export interface ReviewRecord {
  id: string;
  productId: string;
  userId: string;
  rating: number;
  title: string | null;
  body: string | null;
  status: string;
  verifiedPurchase: boolean;
  createdAt: string;
  // Joined from users
  reviewerName: string;
}

export interface ReviewsPage {
  reviews: ReviewRecord[];
  total: number;
  averageRating: number | null;
  reviewCount: number;
}

/** Check whether a user has a DELIVERED order that contained this product. */
async function hasVerifiedPurchase(userId: string, productId: string): Promise<boolean> {
  const r = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.user_id = $1
         AND oi.product_id = $2
         AND o.status = 'DELIVERED'
     ) AS exists`,
    [userId, productId],
  );
  return r.rows[0]?.exists ?? false;
}

export async function createReview(params: {
  productId: string;
  userId: string;
  rating: number;
  title?: string;
  body?: string;
}): Promise<ReviewRecord> {
  const { productId, userId, rating, title, body } = params;

  // Verify the product exists and is customer-visible.
  const product = await pool.query<{ id: string }>(
    `SELECT id FROM products WHERE id = $1 AND status IN ('active','out_of_stock')`,
    [productId],
  );
  if (!product.rows[0]) throw new ReviewError("Product not found.");

  const verifiedPurchase = await hasVerifiedPurchase(userId, productId);

  try {
    const r = await pool.query<{
      id: string;
      product_id: string;
      user_id: string;
      rating: number;
      title: string | null;
      body: string | null;
      status: string;
      verified_purchase: boolean;
      created_at: string;
      reviewer_name: string;
    }>(
      `WITH inserted AS (
         INSERT INTO product_reviews (product_id, user_id, rating, title, body, verified_purchase)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *
       )
       SELECT i.*, (u.first_name || ' ' || LEFT(u.last_name, 1) || '.') AS reviewer_name
       FROM inserted i
       JOIN users u ON u.id = i.user_id`,
      [productId, userId, rating, title ?? null, body ?? null, verifiedPurchase],
    );
    return shapeRow(r.rows[0]);
  } catch (err: unknown) {
    const pg = err as { code?: string };
    if (pg.code === "23505") throw new ReviewError("You've already reviewed this product.");
    throw err;
  }
}

export async function getProductReviews(
  productId: string,
  { limit = 20, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<ReviewsPage> {
  const [reviewsResult, aggResult] = await Promise.all([
    pool.query<{
      id: string;
      product_id: string;
      user_id: string;
      rating: number;
      title: string | null;
      body: string | null;
      status: string;
      verified_purchase: boolean;
      created_at: string;
      reviewer_name: string;
      total: string;
    }>(
      `SELECT r.*,
              (u.first_name || ' ' || LEFT(u.last_name, 1) || '.') AS reviewer_name,
              COUNT(*) OVER () AS total
       FROM product_reviews r
       JOIN users u ON u.id = r.user_id
       WHERE r.product_id = $1 AND r.status = 'approved'
       ORDER BY r.verified_purchase DESC, r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [productId, limit, offset],
    ),
    pool.query<{ average_rating: string | null; review_count: string }>(
      `SELECT AVG(rating)::numeric(3,2) AS average_rating, COUNT(*) AS review_count
       FROM product_reviews WHERE product_id = $1 AND status = 'approved'`,
      [productId],
    ),
  ]);

  const agg = aggResult.rows[0];
  const total = reviewsResult.rows[0] ? Number(reviewsResult.rows[0].total) : 0;

  return {
    reviews: reviewsResult.rows.map(shapeRow),
    total,
    averageRating: agg.average_rating !== null ? Number(agg.average_rating) : null,
    reviewCount: Number(agg.review_count),
  };
}

export async function getUserReviewForProduct(
  productId: string,
  userId: string,
): Promise<ReviewRecord | null> {
  const r = await pool.query<{
    id: string;
    product_id: string;
    user_id: string;
    rating: number;
    title: string | null;
    body: string | null;
    status: string;
    verified_purchase: boolean;
    created_at: string;
    reviewer_name: string;
  }>(
    `SELECT r.*, (u.first_name || ' ' || LEFT(u.last_name, 1) || '.') AS reviewer_name
     FROM product_reviews r
     JOIN users u ON u.id = r.user_id
     WHERE r.product_id = $1 AND r.user_id = $2`,
    [productId, userId],
  );
  return r.rows[0] ? shapeRow(r.rows[0]) : null;
}

// ── Admin ────────────────────────────────────────────────────────────────────

export interface AdminReviewRecord extends ReviewRecord {
  productName: string;
  productSlug: string;
}

export async function listReviewsForAdmin({
  status,
  limit = 50,
  offset = 0,
}: {
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ reviews: AdminReviewRecord[]; total: number }> {
  const params: unknown[] = [];
  const where = status ? `AND r.status = $${params.push(status)}` : "";

  const r = await pool.query<{
    id: string;
    product_id: string;
    user_id: string;
    rating: number;
    title: string | null;
    body: string | null;
    status: string;
    verified_purchase: boolean;
    created_at: string;
    reviewer_name: string;
    product_name: string;
    product_slug: string;
    total: string;
  }>(
    `SELECT r.*,
            (u.first_name || ' ' || LEFT(u.last_name, 1) || '.') AS reviewer_name,
            p.name AS product_name, p.slug AS product_slug,
            COUNT(*) OVER () AS total
     FROM product_reviews r
     JOIN users u ON u.id = r.user_id
     JOIN products p ON p.id = r.product_id
     WHERE true ${where}
     ORDER BY r.created_at DESC
     LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}`,
    params,
  );

  return {
    reviews: r.rows.map((row) => ({
      ...shapeRow(row),
      productName: row.product_name,
      productSlug: row.product_slug,
    })),
    total: r.rows[0] ? Number(r.rows[0].total) : 0,
  };
}

export async function updateReviewStatus(
  reviewId: string,
  status: "approved" | "rejected",
): Promise<void> {
  const r = await pool.query(`UPDATE product_reviews SET status = $2 WHERE id = $1`, [reviewId, status]);
  if ((r.rowCount ?? 0) === 0) throw new ReviewError("Review not found.");
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function shapeRow(row: {
  id: string;
  product_id: string;
  user_id: string;
  rating: number;
  title: string | null;
  body: string | null;
  status: string;
  verified_purchase: boolean;
  created_at: string;
  reviewer_name: string;
}): ReviewRecord {
  return {
    id: row.id,
    productId: row.product_id,
    userId: row.user_id,
    rating: row.rating,
    title: row.title,
    body: row.body,
    status: row.status,
    verifiedPurchase: row.verified_purchase,
    createdAt: row.created_at,
    reviewerName: row.reviewer_name,
  };
}
