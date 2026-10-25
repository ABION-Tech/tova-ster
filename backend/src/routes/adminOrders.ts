import { logAdmin, logEvent } from "../events/eventsRepo.js";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { requireAdmin } from "../auth/adminSession.js";
import { pool } from "../db/pool.js";
import { emailService } from "../services/email/index.js";

const VALID_STATUSES = new Set([
  "PENDING_PAYMENT", "PAID", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED",
]);

// Status transitions the admin is allowed to drive manually.
// Payment webhook owns PENDING_PAYMENT → PAID; everything else is manual.
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PAID: ["PROCESSING", "CANCELLED", "REFUNDED"],
  PROCESSING: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED", "CANCELLED"],
  PENDING_PAYMENT: ["CANCELLED"],
};

export const adminOrderRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // ── GET /admin/orders ────────────────────────────────────────────────────────
  // Paginated list. Supports ?status=PAID&search=TS-2026&limit=50&offset=0.
  // search matches order_number prefix OR customer email (guest or registered).
  app.get("/admin/orders", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;

    const q = req.query as { status?: string; search?: string; limit?: string; offset?: string };
    const limit = Math.min(Number(q.limit ?? 50), 100);
    const offset = Number(q.offset ?? 0);

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (q.status && VALID_STATUSES.has(q.status)) {
      conditions.push(`o.status = $${params.push(q.status)}`);
    }
    if (q.search?.trim()) {
      const term = `%${q.search.trim()}%`;
      conditions.push(
        `(o.order_number ILIKE $${params.push(term)} OR o.guest_email ILIKE $${params.push(term)} OR u.email ILIKE $${params.push(term)})`,
      );
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       ${where}`,
      params,
    );
    const total = Number(countResult.rows[0].count);

    const rows = await pool.query<{
      id: string;
      order_number: string;
      status: string;
      total: string;
      currency: string;
      placed_at: string;
      user_email: string | null;
      guest_email: string | null;
      guest_phone: string | null;
      user_name: string | null;
    }>(
      `SELECT
         o.id, o.order_number, o.status, o.total, o.currency, o.placed_at,
         u.email AS user_email,
         CASE WHEN u.id IS NOT NULL THEN (u.first_name || ' ' || u.last_name) ELSE NULL END AS user_name,
         o.guest_email, o.guest_phone
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       ${where}
       ORDER BY o.placed_at DESC
       LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}`,
      params,
    );

    const orders = rows.rows.map((r) => ({
      id: r.id,
      orderNumber: r.order_number,
      status: r.status,
      total: Number(r.total),
      currency: r.currency,
      placedAt: r.placed_at,
      customerEmail: r.user_email ?? r.guest_email,
      customerName: r.user_name,
      isGuest: !r.user_email,
    }));

    return reply.send({ orders, total, limit, offset });
  });

  // ── GET /admin/orders/:id ────────────────────────────────────────────────────
  app.get("/admin/orders/:id", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;

    const { id } = req.params as { id: string };

    const orderRow = await pool.query<{
      id: string;
      order_number: string;
      status: string;
      currency: string;
      subtotal: string;
      delivery_fee: string;
      discount_total: string;
      total: string;
      placed_at: string;
      delivery_instructions: string | null;
      guest_email: string | null;
      guest_phone: string | null;
      user_id: string | null;
      user_email: string | null;
      user_first_name: string | null;
      user_last_name: string | null;
      user_phone: string | null;
      addr_full_name: string | null;
      addr_phone: string | null;
      addr_line1: string | null;
      addr_line2: string | null;
      addr_city: string | null;
      addr_state: string | null;
      addr_country: string | null;
      addr_postal_code: string | null;
    }>(
      `SELECT
         o.id, o.order_number, o.status, o.currency,
         o.subtotal, o.delivery_fee, o.discount_total, o.total,
         o.placed_at, o.delivery_instructions,
         o.guest_email, o.guest_phone, o.user_id,
         u.email AS user_email, u.first_name AS user_first_name,
         u.last_name AS user_last_name, u.phone AS user_phone,
         a.full_name AS addr_full_name, a.phone AS addr_phone,
         a.line1 AS addr_line1, a.line2 AS addr_line2,
         a.city AS addr_city, a.state AS addr_state,
         a.country AS addr_country, a.postal_code AS addr_postal_code
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       LEFT JOIN addresses a ON a.id = o.shipping_address_id
       WHERE o.id = $1`,
      [id],
    );

    const o = orderRow.rows[0];
    if (!o) return reply.status(404).send({ error: "Order not found." });

    const itemsResult = await pool.query<{
      id: string;
      product_id: string | null;
      product_name_snapshot: string;
      variant_attributes_snapshot: Record<string, string> | null;
      unit_price: string;
      quantity: number;
      line_total: string;
    }>(
      `SELECT id, product_id, product_name_snapshot, variant_attributes_snapshot,
              unit_price, quantity, line_total
       FROM order_items WHERE order_id = $1 ORDER BY created_at ASC`,
      [id],
    );

    const paymentsResult = await pool.query<{
      id: string;
      provider: string;
      provider_reference: string;
      status: string;
      amount: string;
      created_at: string;
      verified_at: string | null;
    }>(
      `SELECT id, provider, provider_reference, status, amount, created_at, verified_at
       FROM payments WHERE order_id = $1 ORDER BY created_at DESC`,
      [id],
    );

    const order = {
      id: o.id,
      orderNumber: o.order_number,
      status: o.status,
      currency: o.currency,
      subtotal: Number(o.subtotal),
      deliveryFee: Number(o.delivery_fee),
      discountTotal: Number(o.discount_total),
      total: Number(o.total),
      placedAt: o.placed_at,
      deliveryInstructions: o.delivery_instructions,
      customer: o.user_id
        ? {
            isGuest: false,
            userId: o.user_id,
            email: o.user_email,
            name: `${o.user_first_name} ${o.user_last_name}`.trim(),
            phone: o.user_phone,
          }
        : { isGuest: true, email: o.guest_email, phone: o.guest_phone, name: null, userId: null },
      shippingAddress: o.addr_line1
        ? {
            fullName: o.addr_full_name,
            phone: o.addr_phone,
            line1: o.addr_line1,
            line2: o.addr_line2,
            city: o.addr_city,
            state: o.addr_state,
            country: o.addr_country,
            postalCode: o.addr_postal_code,
          }
        : null,
      items: itemsResult.rows.map((r) => ({
        id: r.id,
        productId: r.product_id,
        productNameSnapshot: r.product_name_snapshot,
        variantAttributesSnapshot: r.variant_attributes_snapshot,
        unitPrice: Number(r.unit_price),
        quantity: r.quantity,
        lineTotal: Number(r.line_total),
      })),
      payments: paymentsResult.rows.map((r) => ({
        id: r.id,
        provider: r.provider,
        reference: r.provider_reference,
        status: r.status,
        amount: Number(r.amount),
        createdAt: r.created_at,
        verifiedAt: r.verified_at,
      })),
      allowedNextStatuses: ALLOWED_TRANSITIONS[o.status] ?? [],
    };

    return reply.send({ order });
  });

  // ── PATCH /admin/orders/:id/status ───────────────────────────────────────────
  app.patch<{ Body: { status: string; trackingNumber?: string; carrier?: string } }>(
    "/admin/orders/:id/status",
    {
      schema: {
        body: {
          type: "object",
          required: ["status"],
          properties: {
            status: { type: "string" },
            trackingNumber: { type: "string", maxLength: 60 },
            carrier: { type: "string", maxLength: 60 },
          },
        },
      },
    },
    async (req, reply) => {
      const admin = await requireAdmin(req, reply);
      if (!admin) return;

      const { id } = req.params as { id: string };
      const { status: newStatus, trackingNumber, carrier } = req.body;

      if (!VALID_STATUSES.has(newStatus)) {
        return reply.status(400).send({ error: `Invalid status: ${newStatus}` });
      }

      const current = await pool.query<{ status: string }>(
        `SELECT status FROM orders WHERE id = $1`,
        [id],
      );
      if (!current.rows[0]) return reply.status(404).send({ error: "Order not found." });

      const currentStatus = current.rows[0].status;
      const allowed = ALLOWED_TRANSITIONS[currentStatus] ?? [];
      if (!allowed.includes(newStatus)) {
        return reply.status(400).send({
          error: `Cannot transition ${currentStatus} → ${newStatus}. Allowed: ${allowed.join(", ") || "none"}.`,
        });
      }

      // Keep the customer-facing stage, dates and tracking in step with the status.
      const STAGE: Record<string, string> = { PROCESSING: "packed", SHIPPED: "dispatched", DELIVERED: "delivered", CANCELLED: "cancelled", REFUNDED: "cancelled" };
      const upd = await pool.query<{ order_number: string; user_id: string | null; total: string; tracking_number: string | null; carrier: string | null }>(
        `UPDATE orders SET status = $2,
                fulfilment_stage = COALESCE($3, fulfilment_stage),
                tracking_number = COALESCE($4, tracking_number),
                carrier = COALESCE($5, carrier),
                dispatched_at = CASE WHEN $6 THEN now() ELSE dispatched_at END,
                delivered_at  = CASE WHEN $7 THEN now() ELSE delivered_at END
         WHERE id = $1
         RETURNING order_number, user_id, total, tracking_number, carrier`,
        [id, newStatus, STAGE[newStatus] ?? null, trackingNumber?.trim() || null, carrier?.trim() || null, newStatus === "SHIPPED", newStatus === "DELIVERED"],
      );
      const o = upd.rows[0];
      const label: Record<string, string> = { PROCESSING: "packed", SHIPPED: "dispatched", DELIVERED: "delivered", CANCELLED: "cancelled", REFUNDED: "refunded" };
      await logAdmin(admin.id, `${admin.name} marked ${o.order_number} as ${label[newStatus] ?? newStatus.toLowerCase()}`, { orderId: id, from: currentStatus, to: newStatus });
      if (["PROCESSING", "SHIPPED", "DELIVERED"].includes(newStatus)) {
        await logEvent({ type: "dispatch", message: `${o.order_number} ${label[newStatus]}${newStatus === "SHIPPED" && o.tracking_number ? ` (${o.carrier ?? "tracking"} ${o.tracking_number})` : ""}`, userId: o.user_id, meta: { orderId: id, orderNumber: o.order_number, stage: STAGE[newStatus], trackingNumber: o.tracking_number, carrier: o.carrier } });
      }
      if (newStatus === "REFUNDED") {
        await logEvent({ type: "payment", message: `Refunded ${o.order_number}: £${Number(o.total).toFixed(2)}`, userId: o.user_id, meta: { orderId: id, orderNumber: o.order_number, amount: Number(o.total), refund: true } });
      }
      if (newStatus === "CANCELLED") {
        await logEvent({ type: "order", message: `Order ${o.order_number} cancelled`, userId: o.user_id, meta: { orderId: id, orderNumber: o.order_number, from: currentStatus } });
      }

      // Transactional email on customer-facing status transitions (Stage 10).
      // Non-blocking — email failure must never fail the admin action.
      if (newStatus === "SHIPPED" || newStatus === "DELIVERED") {
        const row = await pool.query<{
          order_number: string;
          guest_email: string | null;
          user_email: string | null;
        }>(
          `SELECT o.order_number, o.guest_email, u.email AS user_email
           FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.id = $1`,
          [id],
        );
        const r = row.rows[0];
        const customerEmail = r?.user_email ?? r?.guest_email;
        if (customerEmail && r) {
          const template = newStatus === "SHIPPED" ? "order_shipped" : "order_status_update";
          const subject =
            newStatus === "SHIPPED"
              ? `Your order ${r.order_number} has shipped`
              : `Order ${r.order_number} — Delivered`;
          emailService
            .send({
              to: customerEmail,
              subject,
              template,
              data: {
                trackingCode: o.tracking_number,
                courierName: o.carrier,
                orderNumber: r.order_number,
                status: newStatus,
                statusLabel: newStatus === "DELIVERED" ? "Delivered" : "Shipped",
              },
            }, o.user_id)
            .catch((err) => app.log.error(err, `${template} email failed for order ${id}`));
        }
      }

      return reply.send({ order: { id, status: newStatus } });
    },
  );
};
