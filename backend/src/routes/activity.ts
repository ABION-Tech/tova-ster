import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { pool } from "../db/pool.js";
import { requireAdmin } from "../auth/adminSession.js";
import { getUserFromRequest, requireUser } from "../auth/session.js";
import { listEvents, logEvent, type EventType } from "../events/eventsRepo.js";

// Only these come from the browser; orders, payments and admin changes are logged by the server itself.
const BROWSER_EVENTS: EventType[] = ["visit", "view", "search", "quiz", "checkout"];

export const activityRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * Storefront analytics beacon. The storefront only calls this after the
   * visitor accepts analytics cookies. sessionId is a random id the browser
   * keeps for the visit — never an IP address or fingerprint.
   */
  app.post("/track", {
    config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
    schema: { body: { type: "object", required: ["type", "message"], additionalProperties: false, properties: {
      type: { type: "string", enum: BROWSER_EVENTS }, message: { type: "string", maxLength: 200 },
      sessionId: { type: "string", maxLength: 80 }, meta: { type: "object", maxProperties: 10 },
    } } },
  }, async (req, reply) => {
    const user = await getUserFromRequest(req);
    const b = req.body as { type: EventType; message: string; sessionId?: string; meta?: Record<string, unknown> };
    await logEvent({ type: b.type, message: b.message, userId: user?.id ?? null, sessionId: b.sessionId ?? null, meta: b.meta });
    return reply.status(204).send();
  });

  /** Small per-shopper memory that follows a signed-in customer across devices (quiz result, recently viewed). */
  app.get("/me/saved-state", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const r = await pool.query<{ saved_state: unknown }>(`SELECT saved_state FROM users WHERE id = $1`, [user.id]);
    return reply.send({ state: r.rows[0]?.saved_state ?? {} });
  });

  app.put("/me/saved-state", {
    bodyLimit: 16 * 1024,
    schema: { body: { type: "object", required: ["state"], additionalProperties: false, properties: { state: { type: "object", maxProperties: 20 } } } },
  }, async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { state } = req.body as { state: Record<string, unknown> };
    // Merge, so two devices saving different keys don't overwrite each other.
    await pool.query(`UPDATE users SET saved_state = saved_state || $2::jsonb WHERE id = $1`, [user.id, JSON.stringify(state)]);
    return reply.status(204).send();
  });

  /**
   * Sales funnel for the last N days (default 30): visits, product views,
   * baskets started, checkouts started and paid orders. Visits and views only
   * count shoppers who accepted analytics cookies; baskets, checkouts and
   * orders count everyone, so the first two steps read low.
   */
  app.get("/admin/reports/funnel", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const days = Math.min(365, Math.max(1, Number((req.query as { days?: string }).days) || 30));
    const r = await pool.query<{ visits: number; viewed: number; baskets: number; checkouts: number; paid: number; sales: number }>(
      `WITH w AS (SELECT now() - make_interval(days => $1::int) AS since)
       SELECT
         (SELECT COUNT(DISTINCT session_id) FROM events, w WHERE type = 'visit' AND session_id IS NOT NULL AND created_at > w.since)::int AS visits,
         (SELECT COUNT(DISTINCT session_id) FROM events, w WHERE type = 'view'  AND session_id IS NOT NULL AND created_at > w.since)::int AS viewed,
         (SELECT COUNT(*) FROM carts, w WHERE first_item_at > w.since)::int AS baskets,
         (SELECT COUNT(*) FROM orders, w WHERE created_at > w.since)::int AS checkouts,
         (SELECT COUNT(*) FROM orders, w WHERE created_at > w.since AND status IN ('PAID','PROCESSING','SHIPPED','DELIVERED','REFUNDED'))::int AS paid,
         (SELECT COALESCE(SUM(total), 0) FROM orders, w WHERE created_at > w.since AND status IN ('PAID','PROCESSING','SHIPPED','DELIVERED'))::float AS sales`,
      [days]);
    const f = r.rows[0]!;
    const steps = [
      { key: "visits", label: "Visited the shop", count: f.visits, cookieOnly: true },
      { key: "viewed", label: "Looked at a product", count: f.viewed, cookieOnly: true },
      { key: "baskets", label: "Added to basket", count: f.baskets, cookieOnly: false },
      { key: "checkouts", label: "Started checkout", count: f.checkouts, cookieOnly: false },
      { key: "paid", label: "Paid", count: f.paid, cookieOnly: false },
    ];
    return reply.send({ days, steps, sales: f.sales });
  });

  /** Paid sales by where the buyer first came from (last N days, default 30). */
  app.get("/admin/reports/channels", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const days = Math.min(365, Math.max(1, Number((req.query as { days?: string }).days) || 30));
    const r = await pool.query(
      `SELECT COALESCE(NULLIF(source->>'utm_source', ''), NULLIF(source->>'referrer', ''), 'direct') AS channel,
              COUNT(*)::int AS orders, COALESCE(SUM(total), 0)::float AS sales
       FROM orders WHERE status IN ('PAID','PROCESSING','SHIPPED','DELIVERED') AND placed_at > now() - make_interval(days => $1::int)
       GROUP BY 1 ORDER BY sales DESC`, [days]);
    return reply.send({ days, channels: r.rows });
  });

  /** Searches that found nothing (what shoppers want but can't find), last N days. */
  app.get("/admin/reports/searches", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const days = Math.min(365, Math.max(1, Number((req.query as { days?: string }).days) || 30));
    const r = await pool.query(
      `SELECT lower(meta->>'q') AS words, COUNT(*)::int AS times, bool_or((meta->>'noResults')::boolean) AS no_results
       FROM events WHERE type = 'search' AND meta ? 'q' AND created_at > now() - make_interval(days => $1::int)
       GROUP BY 1 ORDER BY no_results DESC, times DESC LIMIT 50`, [days]);
    return reply.send({ days, searches: r.rows });
  });

  app.get("/admin/activity", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const q = req.query as { type?: string; userId?: string; before?: string; limit?: string };
    const events = await listEvents({ type: q.type || undefined, userId: q.userId || undefined, before: q.before ? Number(q.before) : undefined, limit: q.limit ? Number(q.limit) : undefined });
    return reply.send({ events });
  });
};
