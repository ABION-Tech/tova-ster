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

    const counts: Record<string, number> = {};
    for (const row of statusCounts.rows) counts[row.status] = Number(row.count);

    return reply.send({
      revenue: {
        total: Number(revenue.rows[0].total_revenue),
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
        total: Number(r.total),
        placedAt: r.placed_at,
        customerEmail: r.customer_email,
      })),
    });
  });
};
