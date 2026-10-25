import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { paymentService, paymentProvider } from "../services/payment/index.js";
import { TestPayAdapter } from "../services/payment/TestPayAdapter.js";
import { emailService } from "../services/email/index.js";
import {
  getOrderForPayment,
  getCustomerEmail,
  recordPaymentInitiated,
  findPaymentByReference,
  markPaymentFailed,
  confirmPayment,
  PaymentFlowError,
} from "../payments/paymentRepo.js";
import { pool } from "../db/pool.js";
import { logEvent } from "../events/eventsRepo.js";
import { sendOrderAlerts } from "../orders/adminAlerts.js";

function generateReference(): string {
  return `PAY-${randomBytes(10).toString("hex")}`;
}

export const paymentRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post("/orders/:orderId/pay", async (req, reply) => {
    const { orderId } = req.params as { orderId: string };
    const order = await getOrderForPayment(orderId);
    if (!order) return reply.status(404).send({ error: "Order not found." });
    if (order.status !== "PENDING_PAYMENT") {
      return reply.status(400).send({ error: `Order is already ${order.status} — nothing to pay.` });
    }

    try {
      const email = await getCustomerEmail(order);
      const amountMinor = Math.round(Number(order.total) * 100);

      const providerRef = generateReference();
      const intent = await paymentService.createPaymentIntent({
        amountMinor,
        currency: order.currency,
        reference: providerRef,
        customerEmail: email,
        metadata: { orderId: order.id, orderNumber: order.orderNumber },
      });

      // The provider decides the final reference (Stripe: the Checkout Session id).
      const reference = intent.reference;
      await recordPaymentInitiated({
        orderId: order.id,
        provider: paymentProvider,
        reference,
        amount: Number(order.total),
        currency: order.currency,
      });

      return reply.send({ checkoutUrl: intent.checkoutUrl, reference });
    } catch (err) {
      if (err instanceof PaymentFlowError) return reply.status(400).send({ error: err.message });
      req.log.error(err, "payment initialization failed");
      return reply.status(502).send({ error: "Couldn't start payment. Please try again shortly." });
    }
  });

  app.get("/payments/status", async (req, reply) => {
    const { reference } = req.query as { reference?: string };
    if (!reference) return reply.status(400).send({ error: "reference is required." });

    const payment = await findPaymentByReference(reference);
    if (!payment) return reply.status(404).send({ error: "Unknown payment reference." });

    const orderResult = await pool.query<{ order_number: string; status: string }>(
      `SELECT order_number, status FROM orders WHERE id = $1`,
      [payment.orderId],
    );
    const order = orderResult.rows[0];

    return reply.send({ paymentStatus: payment.status, orderStatus: order?.status ?? null, orderNumber: order?.order_number ?? null });
  });

  // Shared by every provider webhook: re-verify with the provider, compare
  // amount and currency with our own order, then confirm. Never trusts the
  // webhook body's own status.
  async function processVerifiedReference(
    reference: string,
    req: import("fastify").FastifyRequest,
    reply: import("fastify").FastifyReply,
  ) {
    const payment = await findPaymentByReference(reference);
    if (!payment) return reply.status(200).send({ received: true }); // not one of ours

    // Duplicate webhook delivery: already processed, do nothing further.
    if (payment.status === "success") {
      return reply.status(200).send({ received: true, duplicate: true });
    }

    const order = await getOrderForPayment(payment.orderId);
    if (!order) return reply.status(200).send({ received: true });

    const verification = await paymentService.verifyTransaction(reference);

    if (!verification.verified) {
      // Delayed methods stay pending until the provider says otherwise.
      if (verification.status !== "pending") {
        await markPaymentFailed(payment.id, verification.raw);
        await logEvent({ type: "payment", message: `Payment failed for ${order.orderNumber} (£${Number(order.total).toFixed(2)})`, userId: order.userId, meta: { orderId: order.id, orderNumber: order.orderNumber, amount: Number(order.total), status: verification.status } });
      }
      return reply.status(200).send({ received: true });
    }

    const expectedAmountMinor = Math.round(Number(order.total) * 100);
    const currencyOk = !verification.currency || verification.currency.toUpperCase() === order.currency.toUpperCase();
    if (verification.amountMinor !== expectedAmountMinor || !currencyOk) {
      await markPaymentFailed(payment.id, {
        ...(verification.raw as object),
        mismatchExpectedMinor: expectedAmountMinor,
        mismatchExpectedCurrency: order.currency,
      });
      await logEvent({ type: "payment", message: `Payment for ${order.orderNumber} didn't match the order total, so it was not accepted. Needs checking.`, userId: order.userId, meta: { orderId: order.id, orderNumber: order.orderNumber, expected: expectedAmountMinor / 100, received: verification.amountMinor / 100, problem: "mismatch" } });
      req.log.warn(
        `Payment ${reference}: amount/currency mismatch (expected ${expectedAmountMinor} ${order.currency}, got ${verification.amountMinor} ${verification.currency ?? "?"}).`,
      );
      return reply.status(200).send({ received: true });
    }

    await confirmPayment({
      paymentId: payment.id,
      orderId: order.id,
      rawPayload: verification.raw,
      onStockIssue: (message) => req.log.warn(message),
    });

    // Activity: payment, the paid order (with where the buyer came from), and points moved.
    const paid = await pool.query<{ payment_method: string | null; source: Record<string, unknown> | null; receipt_number: string | null }>(
      `SELECT (SELECT provider::text FROM payments WHERE id = $2) AS payment_method, o.source, o.receipt_number::text FROM orders o WHERE o.id = $1`,
      [order.id, payment.id],
    ).catch(() => ({ rows: [] as { payment_method: string | null; source: Record<string, unknown> | null; receipt_number: string | null }[] }));
    const info = paid.rows[0];
    await logEvent({ type: "payment", message: `Payment received for ${order.orderNumber}: £${Number(order.total).toFixed(2)}`, userId: order.userId, meta: { orderId: order.id, orderNumber: order.orderNumber, amount: Number(order.total), method: info?.payment_method ?? null } });
    // (The "order paid" line itself is written inside confirmPayment, in the same transaction.)
    const pts = await pool.query<{ delta: number; reason: string }>(`SELECT delta, reason FROM points_ledger WHERE order_id = $1`, [order.id]);
    for (const l of pts.rows) {
      await logEvent({ type: "points", message: l.delta > 0 ? `Earned ${l.delta} points on ${order.orderNumber}` : `Spent ${-l.delta} points on ${order.orderNumber}`, userId: order.userId, meta: { orderNumber: order.orderNumber, delta: l.delta, reason: l.reason } });
    }

    // Team alerts (new order, low stock). Non-blocking.
    void sendOrderAlerts(order.id);

    // Order confirmation email. Non-blocking — a send failure must never
    // cause a non-200 response or the provider keeps retrying.
    const customerEmail = await getCustomerEmail(order);
    emailService
      .send({
        to: customerEmail,
        subject: `Order confirmed — ${order.orderNumber}`,
        template: "order_confirmation",
        data: { orderNumber: order.orderNumber, total: Number(order.total) },
      }, order.userId)
      .catch((err) => req.log.error(err, "order_confirmation email failed"));

    return reply.status(200).send({ received: true });
  }

  // Registered in its own plugin scope so the raw-buffer content type parser
  // below applies only to webhook routes, not every JSON route in the app.
  await app.register(async (webhookApp) => {
    webhookApp.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => {
      done(null, body);
    });

    webhookApp.post("/webhooks/stripe", async (req, reply) => {
      const rawBody = (req.body as Buffer).toString("utf8");
      const signature = (req.headers["stripe-signature"] as string) ?? "";
      if (!paymentService.verifyWebhookSignature(rawBody, signature)) {
        return reply.status(401).send({ error: "Invalid signature." });
      }

      const event = JSON.parse(rawBody) as { type: string; data: { object: { id: string } } };
      const sessionId = event.data?.object?.id;

      switch (event.type) {
        case "checkout.session.completed":
        case "checkout.session.async_payment_succeeded":
          return processVerifiedReference(sessionId, req, reply);
        case "checkout.session.async_payment_failed":
        case "checkout.session.expired": {
          const payment = await findPaymentByReference(sessionId);
          if (payment && payment.status !== "success") await markPaymentFailed(payment.id, event.data.object);
          return reply.status(200).send({ received: true });
        }
        default:
          return reply.status(200).send({ received: true }); // acknowledged, no action
      }
    });

    // Test checkout only (PAYMENT_PROVIDER=test, never production): the test
    // payment page's Pay button lands here, then goes through the same
    // verification and confirmation as a real Stripe webhook.
    webhookApp.post("/webhooks/test", async (req, reply) => {
      if (paymentProvider !== "test" || process.env.NODE_ENV === "production") return reply.status(404).send({ error: "Not enabled." });
      const { reference } = JSON.parse((req.body as Buffer).toString("utf8") || "{}") as { reference?: string };
      if (!reference || !TestPayAdapter.markPaid(reference)) return reply.status(404).send({ error: "Unknown test payment." });
      return processVerifiedReference(reference, req, reply);
    });

    // Kept for the optional Paystack adapter; inactive unless PAYMENT_PROVIDER=paystack.
    webhookApp.post("/webhooks/paystack", async (req, reply) => {
      if (paymentProvider !== "paystack") return reply.status(404).send({ error: "Not enabled." });
      const rawBody = (req.body as Buffer).toString("utf8");
      const signature = (req.headers["x-paystack-signature"] as string) ?? "";
      if (!paymentService.verifyWebhookSignature(rawBody, signature)) {
        return reply.status(401).send({ error: "Invalid signature." });
      }
      const event = JSON.parse(rawBody);
      if (event.event !== "charge.success") return reply.status(200).send({ received: true });
      return processVerifiedReference(event.data.reference, req, reply);
    });
  });
};
