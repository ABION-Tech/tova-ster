import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { pool } from "../db/pool.js";
import type { ProductRecord, VariantRecord, ProductImageRecord } from "../products/productRepo.js";

// Customers should see active and out-of-stock products (so an out-of-stock
// item still shows up with an honest "unavailable" state) — never draft or
// archived, which aren't real listings yet or aren't anymore.
const CUSTOMER_VISIBLE_STATUSES = ["active", "out_of_stock"];
const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 48;

const SORTS = {
  newest: "p.created_at DESC",
  price_asc: "effective_price ASC",
  price_desc: "effective_price DESC",
} as const;

export const publicProductRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get("/products", async (req, reply) => {
    const query = req.query as {
      category?: string;
      search?: string;
      sort?: keyof typeof SORTS;
      inStockOnly?: string;
      minPrice?: string;
      maxPrice?: string;
      limit?: string;
      offset?: string;
    };

    const conditions = [`p.status = ANY($1)`];
    const params: unknown[] = [CUSTOMER_VISIBLE_STATUSES];

    if (query.category) {
      params.push(query.category);
      conditions.push(`c.slug = $${params.length}`);
    }
    if (query.search) {
      params.push(`%${query.search}%`);
      conditions.push(`p.name ILIKE $${params.length}`);
    }
    if (query.inStockOnly === "true") {
      conditions.push(`p.status = 'active'`);
    }
    // Approximation: filters/sorts on the product's own base/discount price.
    // A variant with its own price override isn't reflected here — accurate
    // enough for browsing/filtering, but the PDP always shows the real
    // per-variant price. Worth revisiting if variant pricing spreads widely
    // from the base price in the client's real catalogue.
    if (query.minPrice) {
      params.push(Number(query.minPrice));
      conditions.push(`COALESCE(p.discount_price, p.base_price) >= $${params.length}`);
    }
    if (query.maxPrice) {
      params.push(Number(query.maxPrice));
      conditions.push(`COALESCE(p.discount_price, p.base_price) <= $${params.length}`);
    }

    const sort = SORTS[query.sort ?? "newest"] ?? SORTS.newest;
    const limit = Math.min(Number(query.limit) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const offset = Number(query.offset) || 0;

    params.push(limit + 1, offset); // fetch one extra row to know if there's a next page

    const result = await pool.query<
      ProductRecord & { category_name: string | null; category_slug: string | null; primary_image: string | null; average_rating: string | null; review_count: string }
    >(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug,
              COALESCE(p.discount_price, p.base_price) AS effective_price,
              (SELECT url FROM product_images WHERE product_id = p.id ORDER BY is_primary DESC, sort_order ASC LIMIT 1) AS primary_image,
              rev.average_rating, rev.review_count
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN (
         SELECT product_id,
                AVG(rating)::numeric(3,2) AS average_rating,
                COUNT(*) AS review_count
         FROM product_reviews WHERE status = 'approved'
         GROUP BY product_id
       ) rev ON rev.product_id = p.id
       WHERE ${conditions.join(" AND ")}
       ORDER BY ${sort}
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const hasMore = result.rows.length > limit;
    const products = result.rows.slice(0, limit).map((row) => ({
      ...row,
      averageRating: row.average_rating !== null ? Number(row.average_rating) : null,
      reviewCount: Number(row.review_count ?? 0),
      images: row.primary_image ? [{ id: row.id, url: row.primary_image, product_variant_id: null, is_primary: true }] : [],
    }));

    return reply.send({ products, hasMore, nextOffset: offset + products.length });
  });

  app.get("/products/:slug", async (req, reply) => {
    const { slug } = req.params as { slug: string };

    const productResult = await pool.query<ProductRecord & { category_name: string | null; category_slug: string | null; average_rating: string | null; review_count: string }>(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug,
              rev.average_rating, rev.review_count
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN (
         SELECT product_id,
                AVG(rating)::numeric(3,2) AS average_rating,
                COUNT(*) AS review_count
         FROM product_reviews WHERE status = 'approved'
         GROUP BY product_id
       ) rev ON rev.product_id = p.id
       WHERE p.slug = $1 AND p.status = ANY($2)`,
      [slug, CUSTOMER_VISIBLE_STATUSES],
    );
    const product = productResult.rows[0];
    if (!product) return reply.status(404).send({ error: "Product not found." });

    const [variants, images] = await Promise.all([
      pool.query<VariantRecord>(
        `SELECT * FROM product_variants WHERE product_id = $1 AND status = ANY($2) ORDER BY created_at ASC`,
        [product.id, CUSTOMER_VISIBLE_STATUSES],
      ),
      pool.query<ProductImageRecord>(
        `SELECT * FROM product_images WHERE product_id = $1 ORDER BY sort_order ASC, created_at ASC`,
        [product.id],
      ),
    ]);

    return reply.send({
      product: {
        ...product,
        averageRating: product.average_rating !== null ? Number(product.average_rating) : null,
        reviewCount: Number(product.review_count ?? 0),
        variants: variants.rows,
        images: images.rows,
      },
    });
  });
};

