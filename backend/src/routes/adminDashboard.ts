import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { requireAdmin } from "../auth/adminSession.js";
import { pool } from "../db/pool.js";

export const adminDashboardRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get("/admin/dashboard", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;

    const [statusCounts, revenue, lowStockProducts, lowStockVariants, recentOrders] =
      await Promise.all([
        // ── Order counts by status ───────────────────────────────────────────
        pool.query<{ status: string; count: string }>(
          `SELECT status, COUNT(*) AS count FROM orders GROUP BY status`,
        ),

        // ── Revenue from fulfilled orders ────────────────────────────────────
        pool.query<{ total_revenue: string; order_count: string }>(
          `SELECT COALESCE(SUM(total), 0) AS total_revenue, COUNT(*) AS order_count
           FROM orders
           WHERE status IN ('PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED')`,
        ),

        // ── Products without variants that are at or below their threshold ───
        pool.query<{
          id: string;
          name: string;
          slug: string;
          status: string;
          stock: number;
          low_stock_threshold: number;
        }>(
          `SELECT id, name, slug, status, stock, low_stock_threshold
           FROM products
           WHERE NOT has_variants
             AND stock IS NOT NULL
             AND stock <= low_stock_threshold
             AND status != 'archived'
           ORDER BY stock ASC
           LIMIT 25`,
        ),

        // ── Variants at or below their threshold ─────────────────────────────
        pool.query<{
          id: string;
          product_id: string;
          product_name: string;
          product_slug: string;
          attributes: Record<string, string>;
          stock: number;
          low_stock_threshold: number;
          status: string;
        }>(
          `SELECT
             v.id, v.product_id, p.name AS product_name, p.slug AS product_slug,
             v.attributes, v.stock, v.low_stock_threshold, v.status
           FROM product_variants v
           JOIN products p ON p.id = v.product_id
           WHERE v.stock <= v.low_stock_threshold
             AND v.status != 'archived'
             AND p.status != 'archived'
           ORDER BY v.stock ASC
           LIMIT 25`,
        ),

        // ── 10 most recent orders ────────────────────────────────────────────
        pool.query<{
          id: string;
          order_number: string;
          status: string;
          total: string;
          placed_at: string;
          customer_email: string | null;
        }>(
          `SELECT
             o.id, o.order_number, o.status, o.total, o.placed_at,
             COALESCE(u.email, o.guest_email) AS customer_email
           FROM orders o
           LEFT JOIN users u ON u.id = o.user_id
           ORDER BY o.placed_at DESC
           LIMIT 10`,
        ),
      ]);

    // At-a-glance figures on UK dates. Packers see the work, not the money.
    const LDN = `(placed_at AT TIME ZONE 'Europe/London')::date`;
    const TODAY = `(now() AT TIME ZONE 'Europe/London')::date`;
    const PAIDS = `status IN ('PAID','PROCESSING','SHIPPED','DELIVERED')`;
    const [glance, series] = await Promise.all([
      pool.query<{ today: string; today_n: string; week: string; week_n: string; to_pack: string; new_customers: string; active_subs: string }>(
        `SELECT
           (SELECT coalesce(sum(total),0) FROM orders WHERE ${PAIDS} AND ${LDN} = ${TODAY}) AS today,
           (SELECT count(*) FROM orders WHERE ${PAIDS} AND ${LDN} = ${TODAY}) AS today_n,
           (SELECT coalesce(sum(total),0) FROM orders WHERE ${PAIDS} AND ${LDN} > ${TODAY} - 7) AS week,
           (SELECT count(*) FROM orders WHERE ${PAIDS} AND ${LDN} > ${TODAY} - 7) AS week_n,
           (SELECT count(*) FROM orders WHERE status IN ('PAID','PROCESSING')) AS to_pack,
           (SELECT count(*) FROM users WHERE created_at > now() - interval '7 days') AS new_customers,
           (SELECT count(*) FROM subscriptions WHERE status = 'active') AS active_subs`,
      ),
      pool.query<{ day: string; total: string; n: string }>(
        `SELECT d::date::text AS day, coalesce(sum(o.total),0) AS total, count(o.id) AS n
           FROM generate_series((now() AT TIME ZONE 'Europe/London')::date - 13, (now() AT TIME ZONE 'Europe/London')::date, '1 day') d
           LEFT JOIN orders o ON (o.placed_at AT TIME ZONE 'Europe/London')::date = d::date AND o.${PAIDS}
          GROUP BY d ORDER BY d`,
      ),
    ]);
    const g = glance.rows[0];
    const money = admin.role !== "Packer";
    const counts: Record<string, number> = {};
    for (const row of statusCounts.rows) counts[row.status] = Number(row.count);

    return reply.send({
      glance: {
        todaySales: money ? Number(g.today) : null, todayOrders: Number(g.today_n),
        weekSales: money ? Number(g.week) : null, weekOrders: Number(g.week_n),
        toPack: Number(g.to_pack), newCustomers: Number(g.new_customers), activeSubscriptions: Number(g.active_subs),
      },
      series: money ? series.rows.map((r) => ({ day: r.day, total: Number(r.total), orders: Number(r.n) })) : [],
      revenue: {
        total: money ? Number(revenue.rows[0].total_revenue) : 0,
        orderCount: Number(revenue.rows[0].order_count),
      },
      orderCounts: counts,
      lowStock: {
        products: lowStockProducts.rows.map((r) => ({
          id: r.id,
          name: r.name,
          slug: r.slug,
          status: r.status,
          stock: r.stock,
          threshold: r.low_stock_threshold,
        })),
        variants: lowStockVariants.rows.map((r) => ({
          id: r.id,
          productId: r.product_id,
          productName: r.product_name,
          productSlug: r.product_slug,
          attributes: r.attributes,
          stock: r.stock,
          threshold: r.low_stock_threshold,
          status: r.status,
        })),
      },
      recentOrders: recentOrders.rows.map((r) => ({
        id: r.id,
        orderNumber: r.order_number,
        status: r.status,
        total: money ? Number(r.total) : null,
        placedAt: r.placed_at,
        customerEmail: r.customer_email,
      })),
    });
  });
};
