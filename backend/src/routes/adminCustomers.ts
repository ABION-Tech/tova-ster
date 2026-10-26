import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { pool } from "../db/pool.js";
import { requireAdmin } from "../auth/adminSession.js";
import { logEvent } from "../events/eventsRepo.js";

/**
 * Customers page (Owner, Manager, Support): find a customer and see
 * everything needed to answer a question: orders, points, subscriptions,
 * birthday, addresses, recent activity and the team's notes. Support can add
 * notes and adjust points (with a reason); both are recorded.
 * Never returns passwords, tokens or saved basket state.
 */
const PAID = `('PAID','PROCESSING','SHIPPED','DELIVERED')`;

export const adminCustomerRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get("/admin/customers", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;
    const q = req.query as { q?: string; limit?: string; offset?: string };
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 50));
    const offset = Math.max(0, Number(q.offset) || 0);
    const term = (q.q ?? "").trim();
    const params: unknown[] = [];
    let where = "u.erased_at IS NULL";
    if (term) {
      params.push(`%${term}%`);
      where += ` AND (u.email ILIKE $1 OR (u.first_name || ' ' || u.last_name) ILIKE $1 OR u.phone ILIKE $1)`;
    }
    const count = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM users u WHERE ${where}`, params);
    const rows = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.created_at, u.points_balance, u.marketing_email,
              count(o.id) FILTER (WHERE o.status IN ${PAID})::int AS orders,
              coalesce(sum(o.total) FILTER (WHERE o.status IN ${PAID}), 0)::numeric(12,2) AS spent,
              max(o.placed_at) FILTER (WHERE o.status IN ${PAID}) AS last_order_at
         FROM users u LEFT JOIN orders o ON o.user_id = u.id
        WHERE ${where}
        GROUP BY u.id
        ORDER BY max(o.placed_at) DESC NULLS LAST, u.created_at DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    return reply.send({
      total: Number(count.rows[0].n), limit, offset,
      customers: rows.rows.map((r) => ({ ...r, spent: Number(r.spent) })),
    });
  });

  app.get("/admin/customers/:id", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;
    const { id } = req.params as { id: string };
    const u = await pool.query(
      `SELECT id, email, first_name, last_name, phone, email_verified, created_at, points_balance, marketing_email,
              acquisition_source, birthday_day, birthday_month, erased_at
         FROM users WHERE id = $1`, [id]);
    if (!u.rows[0]) return reply.status(404).send({ error: "Customer not found." });
    const [orders, points, subs, notes, addresses, activity] = await Promise.all([
      pool.query(`SELECT id, order_number, status, total, placed_at, created_at FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, [id]),
      pool.query(`SELECT p.delta, p.reason, p.created_at, o.order_number, a.name AS by
                    FROM points_ledger p LEFT JOIN orders o ON o.id = p.order_id LEFT JOIN admin_users a ON a.id = p.created_by
                   WHERE p.user_id = $1 ORDER BY p.created_at DESC LIMIT 50`, [id]),
      pool.query(`SELECT id, product_name, quantity, interval_months, unit_price, status, next_charge_at FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC`, [id]),
      pool.query(`SELECT n.id, n.body, n.created_at, a.name AS by FROM customer_notes n LEFT JOIN admin_users a ON a.id = n.created_by WHERE n.user_id = $1 ORDER BY n.created_at DESC`, [id]),
      pool.query(`SELECT label, full_name, line1, line2, city, postal_code, country, is_default FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC`, [id]),
      pool.query(`SELECT type, message, created_at FROM events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 40`, [id]),
    ]);
    return reply.send({
      customer: u.rows[0],
      orders: orders.rows.map((r) => ({ ...r, total: Number(r.total) })),
      points: points.rows,
      subscriptions: subs.rows.map((r) => ({ ...r, unit_price: Number(r.unit_price) })),
      notes: notes.rows,
      addresses: addresses.rows,
      activity: activity.rows,
    });
  });

  app.post("/admin/customers/:id/notes", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;
    const { id } = req.params as { id: string };
    const body = String((req.body as { body?: string } | undefined)?.body ?? "").trim().slice(0, 2000);
    if (!body) return reply.status(400).send({ error: "Write a note first." });
    const ok = await pool.query(`SELECT 1 FROM users WHERE id = $1`, [id]);
    if (!ok.rowCount) return reply.status(404).send({ error: "Customer not found." });
    await pool.query(`INSERT INTO customer_notes (user_id, body, created_by) VALUES ($1, $2, $3)`, [id, body, admin.id]);
    await logEvent({ type: "admin", adminId: admin.id, userId: id, message: `${admin.name} added a note to a customer`, meta: { action: "customer_note" } });
    return reply.status(201).send({ ok: true });
  });

  app.post("/admin/customers/:id/points", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { delta?: number; reason?: string };
    const delta = Math.trunc(Number(b.delta));
    const reason = String(b.reason ?? "").trim().slice(0, 200);
    if (!delta || Math.abs(delta) > 10000) return reply.status(400).send({ error: "Enter a number of points between -10,000 and 10,000." });
    if (!reason) return reply.status(400).send({ error: "Give a reason; it is shown in the customer's points history." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const cur = await client.query<{ points_balance: number }>(`SELECT points_balance FROM users WHERE id = $1 FOR UPDATE`, [id]);
      if (!cur.rows[0]) { await client.query("ROLLBACK"); return reply.status(404).send({ error: "Customer not found." }); }
      if (cur.rows[0].points_balance + delta < 0) { await client.query("ROLLBACK"); return reply.status(400).send({ error: `They only have ${cur.rows[0].points_balance} points.` }); }
      await client.query(`UPDATE users SET points_balance = points_balance + $2 WHERE id = $1`, [id, delta]);
      await client.query(`INSERT INTO points_ledger (user_id, delta, reason, created_by) VALUES ($1, $2, $3, $4)`, [id, delta, reason, admin.id]);
      await client.query("COMMIT");
      await logEvent({ type: "points", adminId: admin.id, userId: id, message: `${admin.name} ${delta > 0 ? "added" : "removed"} ${Math.abs(delta)} points: ${reason}`, meta: { action: "points_adjust", delta } });
      return reply.send({ ok: true, balance: cur.rows[0].points_balance + delta });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });
};
