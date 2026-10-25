import { receiptForCustomer, receiptForPaymentReference } from "../orders/receipt.js";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { getUserFromRequest, requireUser } from "../auth/session.js";
import { getOrCreateCart } from "../cart/cartService.js";
import { createOrderFromCart, OrderError } from "../orders/orderRepo.js";
import { pool } from "../db/pool.js";

export const orderRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post(
    "/orders",
    {
      schema: {
        body: {
          type: "object",
          required: ["customer", "delivery"],
          properties: {
            customer: {
              type: "object",
              required: ["name", "email", "phone"],
              properties: {
                name: { type: "string", minLength: 1 },
                email: { type: "string", minLength: 3 },
                phone: { type: "string", minLength: 1 },
              },
            },
            delivery: {
              type: "object",
              required: ["recipientName", "phone", "line1", "city", "postalCode"],
              properties: {
                recipientName: { type: "string", minLength: 1 },
                phone: { type: "string", minLength: 1 },
                line1: { type: "string", minLength: 1 },
                line2: { type: "string" },
                city: { type: "string", minLength: 1 },
                postalCode: { type: "string", minLength: 5 },
                state: { type: "string" },
                instructions: { type: "string" },
              },
            },
            // Where this shopper first came from (saved by the browser on their first visit).
            source: {
              type: "object", additionalProperties: false,
              properties: Object.fromEntries(["referrer", "utm_source", "utm_medium", "utm_campaign", "utm_content", "landing", "device", "firstSeen"].map((k) => [k, { type: "string", maxLength: 200 }])),
            },
          },
        },
      },
    },
      async (req, reply) => {
      const user = await getUserFromRequest(req);
      const cart = await getOrCreateCart(req, reply, user);
      const body = req.body as { customer: import("../orders/orderRepo.js").CustomerInfo; delivery: import("../orders/orderRepo.js").DeliveryInfo };

      try {
        const order = await createOrderFromCart({
          cartId: cart.id,
          userId: user?.id ?? null,
          customer: body.customer,
          delivery: body.delivery,
        });
        const src = (req.body as { source?: Record<string, string> }).source;
        if (src && Object.keys(src).length) await pool.query(`UPDATE orders SET source = $2 WHERE id = $1`, [order.id, JSON.stringify(src)]);
        return reply.status(201).send({ order });
      } catch (err) {
        if (err instanceof OrderError) return reply.status(400).send({ error: err.message });
        throw err;
      }
    },
  );

  // ── GET /orders ─────────────────────────────────────────────────────────────
  // Customer's own order history — most recent first, capped at 50.
  app.get("/orders", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const result = await pool.query<{
      id: string; order_number: string; status: string;
      total: string; currency: string; placed_at: string; item_count: string;
      fulfilment_stage: string; tracking_number: string | null; carrier: string | null;
    }>(
      `SELECT o.id, o.order_number, o.status, o.total, o.currency, o.placed_at, o.fulfilment_stage, o.tracking_number, o.carrier,
              COUNT(oi.id) AS item_count
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
       WHERE o.user_id = $1 AND o.status <> 'PENDING_PAYMENT'
       GROUP BY o.id
       ORDER BY o.placed_at DESC
       LIMIT 50`,
      [user.id],
    );

    return reply.send({
      orders: result.rows.map((r) => ({
        id: r.id,
        orderNumber: r.order_number,
        status: r.status,
        total: Number(r.total),
        currency: r.currency,
        placedAt: r.placed_at,
        itemCount: Number(r.item_count),
        stage: r.fulfilment_stage,
        trackingNumber: r.tracking_number,
        carrier: r.carrier,
      })),
    });
  });

  // ── GET /orders/:orderNumber ─────────────────────────────────────────────────
  // Full order detail. Scoped to the signed-in customer — returns 404 rather
  // than 403 for orders that exist but belong to someone else (no information leak).
  // Receipt for the thank-you page (guests too): the Stripe reference in the
  // return URL is the key. Only shown once the payment has gone through.
  app.get("/receipts/by-reference", async (req, reply) => {
    const { reference } = req.query as { reference?: string };
    if (!reference || reference.length > 200) return reply.status(400).send({ error: "reference is required." });
    const receipt = await receiptForPaymentReference(reference);
    if (!receipt) return reply.status(404).send({ error: "Receipt not found." });
    reply.header("Cache-Control", "private, no-store");
    if (receipt.status === "PENDING_PAYMENT") return reply.send({ pending: true, orderNumber: receipt.orderNumber });
    return reply.send({ receipt });
  });

  app.get("/orders/:orderNumber/receipt", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const receipt = await receiptForCustomer((req.params as { orderNumber: string }).orderNumber, user.id);
    if (!receipt) return reply.status(404).send({ error: "Order not found." });
    return reply.send({ receipt });
  });

  app.get("/orders/:orderNumber", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const { orderNumber } = req.params as { orderNumber: string };

    const orderRow = await pool.query<{
      id: string; order_number: string; status: string; currency: string;
      subtotal: string; delivery_fee: string; discount_total: string; total: string;
      placed_at: string; delivery_instructions: string | null;
      addr_full_name: string | null; addr_phone: string | null;
      addr_line1: string | null; addr_line2: string | null;
      addr_city: string | null; addr_state: string | null;
    }>(
      `SELECT o.id, o.order_number, o.status, o.currency,
              o.subtotal, o.delivery_fee, o.discount_total, o.total,
              o.placed_at, o.delivery_instructions,
              a.full_name AS addr_full_name, a.phone AS addr_phone,
              a.line1 AS addr_line1, a.line2 AS addr_line2,
              a.city AS addr_city, a.state AS addr_state
       FROM orders o
       LEFT JOIN addresses a ON a.id = o.shipping_address_id
       WHERE o.order_number = $1 AND o.user_id = $2`,
      [orderNumber, user.id],
    );
    const o = orderRow.rows[0];
    if (!o) return reply.status(404).send({ error: "Order not found." });

    const itemsResult = await pool.query<{
      id: string; product_name_snapshot: string;
      variant_attributes_snapshot: Record<string, string> | null;
      unit_price: string; quantity: number; line_total: string;
    }>(
      `SELECT id, product_name_snapshot, variant_attributes_snapshot,
              unit_price, quantity, line_total
       FROM order_items WHERE order_id = $1 ORDER BY created_at ASC`,
      [o.id],
    );

    const paymentRow = await pool.query<{ status: string; provider: string }>(
      `SELECT status, provider FROM payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [o.id],
    );

    return reply.send({
      order: {
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
        shippingAddress: o.addr_line1
          ? { fullName: o.addr_full_name, phone: o.addr_phone, line1: o.addr_line1, line2: o.addr_line2, city: o.addr_city, state: o.addr_state }
          : null,
        payment: paymentRow.rows[0]
          ? { status: paymentRow.rows[0].status, provider: paymentRow.rows[0].provider }
          : null,
        items: itemsResult.rows.map((r) => ({
          id: r.id,
          productNameSnapshot: r.product_name_snapshot,
          variantAttributesSnapshot: r.variant_attributes_snapshot,
          unitPrice: Number(r.unit_price),
          quantity: r.quantity,
          lineTotal: Number(r.line_total),
        })),
      },
    });
  });
};
