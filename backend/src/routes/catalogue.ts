import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { pool } from "../db/pool.js";
import { getAllSettings } from "../settings/settingsRepo.js";

/**
 * The whole live range in one cacheable call (the catalogue is small), so the
 * shop, filters, quiz and basket suggestions work without waiting on the
 * network. Exact stock is never sent: only "only N left" when it is under the
 * admin's urgency threshold.
 */
export const catalogueRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get("/catalogue", async (_req, reply) => {
    const s = await getAllSettings();
    const hideOOS = s.dispatch.autoHideOOS;
    const r = await pool.query(
      `SELECT p.id, p.slug, p.name, p.short_description, p.description, p.pack_size, p.format, p.servings, p.needs, p.audiences, p.badge,
              p.benefits, p.how_to_take, p.ingredients, p.facts, p.warnings, p.video_url, p.sort_order,
              COALESCE(p.discount_price, p.base_price)::float AS price, p.base_price::float AS was_price, p.stock, p.status, p.created_at,
              c.slug AS category,
              COALESCE((SELECT json_agg(json_build_object('url', i.url, 'alt', i.alt_text) ORDER BY i.is_primary DESC, i.sort_order)
                        FROM product_images i WHERE i.product_id = p.id), '[]') AS images,
              (SELECT round(avg(rating)::numeric, 1)::float FROM product_reviews rv WHERE rv.product_id = p.id AND rv.status = 'approved') AS rating,
              (SELECT count(*)::int FROM product_reviews rv WHERE rv.product_id = p.id AND rv.status = 'approved') AS review_count
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.status IN ('active', 'out_of_stock')
       ORDER BY p.sort_order, p.created_at`,
    );
    const under = s.features.stockUrgency.on ? Number(s.features.stockUrgency.under) : 0;
    const products = r.rows
      .filter((p) => !(hideOOS && (p.status === "out_of_stock" || (p.stock !== null && p.stock <= 0))))
      .map(({ stock, was_price, ...p }) => ({
        ...p,
        wasPrice: was_price > p.price ? was_price : null,
        inStock: p.status === "active" && (stock === null || stock > 0),
        onlyLeft: stock !== null && stock > 0 && stock < under ? stock : null,
      }));
    reply.header("Cache-Control", "public, max-age=30, stale-while-revalidate=300");
    return reply.send({ products });
  });
};
