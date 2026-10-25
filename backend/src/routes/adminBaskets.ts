import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { pool } from "../db/pool.js";
import { requireAdmin } from "../auth/adminSession.js";
import { getSetting } from "../settings/settingsRepo.js";

/**
 * Abandoned baskets: active baskets with items, untouched for longer than
 * emails.basketAfterHours (24 h by default), never checked out. Shows who
 * (account, or the email/postcode a guest typed at checkout), what, how much,
 * and whether we may email them (account marketing consent or newsletter).
 */
export const adminBasketRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get("/admin/baskets", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const q = req.query as { days?: string };
    const days = Math.min(90, Math.max(1, Number(q.days) || 30));
    const hours = Math.max(1, Number((await getSetting("emails")).basketAfterHours) || 24);
    const r = await pool.query(
      `WITH b AS (
         SELECT c.id, c.user_id, c.last_activity_at, c.postcode,
                COALESCE(u.email, c.email) AS email,
                NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS name,
                (u.marketing_email IS TRUE OR EXISTS (SELECT 1 FROM newsletter_subscribers n WHERE lower(n.email) = lower(COALESCE(u.email, c.email)) AND n.unsubscribed_at IS NULL)) AS can_email
         FROM carts c LEFT JOIN users u ON u.id = c.user_id
         WHERE c.status = 'active'
           AND c.last_activity_at < now() - make_interval(hours => $1::int)
           AND c.last_activity_at > now() - make_interval(days => $2::int)
           AND EXISTS (SELECT 1 FROM cart_items ci WHERE ci.cart_id = c.id)
       )
       SELECT b.*, (SELECT COALESCE(SUM(ci.quantity * p.base_price), 0)::float FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.cart_id = b.id) AS value,
              (SELECT json_agg(json_build_object('name', p.name, 'qty', ci.quantity, 'sub', ci.subscription_months IS NOT NULL) ORDER BY p.name)
                 FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.cart_id = b.id) AS items
       FROM b ORDER BY b.last_activity_at DESC LIMIT 300`,
      [hours, days],
    );
    const baskets = r.rows.map((x) => ({ ...x, guest: !x.user_id }));
    const total = baskets.reduce((s, x) => s + Number(x.value), 0);
    return reply.send({ hours, days, count: baskets.length, value: Math.round(total * 100) / 100, contactable: baskets.filter((x) => x.email && x.can_email).length, baskets });
  });
};
