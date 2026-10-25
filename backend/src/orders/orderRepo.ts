import { randomBytes } from "node:crypto";
import { pool } from "../db/pool.js";
import { getCartSummary, rememberOnCart } from "../cart/cartItemsRepo.js";
import { deliveryZone, formatPostcode, UnsupportedDestinationError } from "../services/delivery/index.js";
import { logEvent } from "../events/eventsRepo.js";

export class OrderError extends Error {}

export interface CustomerInfo {
  name: string;
  email: string;
  phone: string;
}

export interface DeliveryInfo {
  recipientName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  postalCode: string;
  state?: string; // county, optional
  instructions?: string;
}

function generateOrderNumber(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = randomBytes(3).toString("hex").toUpperCase();
  return `TS-${date}-${suffix}`;
}

/**
 * Creates an Order + OrderItems from the caller's current basket, in
 * PENDING_PAYMENT status — never PAID. Every figure comes from the pricing
 * engine run on live product data and today's admin settings, never from the
 * browser. The payment webhook re-verifies the amount before marking it paid.
 * The basket stays active until payment succeeds.
 */
export async function createOrderFromCart(params: {
  cartId: string;
  userId: string | null;
  customer: CustomerInfo;
  delivery: DeliveryInfo;
}): Promise<{ id: string; orderNumber: string; total: number }> {
  const { cartId, userId, customer, delivery } = params;

  try {
    deliveryZone(delivery.postalCode);
  } catch (err) {
    if (err instanceof UnsupportedDestinationError) throw new OrderError(err.message);
    throw err;
  }
  const email = customer.email.trim().toLowerCase();
  // Remember for next time (and for basket reminders) even if payment is abandoned.
  await rememberOnCart(cartId, { postcode: delivery.postalCode, email });

  const summary = await getCartSummary(cartId, { postcode: delivery.postalCode, email });
  if (summary.items.length === 0) throw new OrderError("Your basket is empty.");
  if (summary.hasBlockingIssues) {
    throw new OrderError("Some items in your basket are no longer available at the requested quantity.");
  }
  if (summary.codeError) throw new OrderError(`${summary.codeError} Remove it to continue.`);
  const p = summary.pricing;
  if (p.total < 0.3) throw new OrderError("The order total is too small to take a card payment.");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const addressResult = await client.query<{ id: string }>(
      `INSERT INTO addresses (user_id, full_name, phone, line1, line2, city, state, postal_code, country)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'GB')
       RETURNING id`,
      [userId, delivery.recipientName, delivery.phone, delivery.line1, delivery.line2 ?? null, delivery.city, delivery.state ?? null, formatPostcode(delivery.postalCode)],
    );
    const addressId = addressResult.rows[0].id;
    const orderNumber = generateOrderNumber();

    const orderResult = await client.query<{ id: string }>(
      `INSERT INTO orders (
         order_number, user_id, guest_email, guest_phone, status, currency,
         subtotal, delivery_fee, discount_total, total, shipping_address_id, delivery_instructions, vat_total,
         discounts, points_used, points_earned, discount_code, has_subscription, cart_id
       )
       VALUES ($1, $2, $3, $4, 'PENDING_PAYMENT', 'GBP', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING id`,
      [
        orderNumber, userId, userId ? null : email, userId ? null : customer.phone,
        p.full, p.delivery, p.saved, p.total, addressId, delivery.instructions ?? null, p.vat,
        JSON.stringify(p.discounts), p.pointsUsed, userId ? p.pointsEarned : 0,
        p.codeSaving > 0 ? p.code : null, p.hasSubscription, cartId,
      ],
    );
    const orderId = orderResult.rows[0].id;

    for (const item of summary.items) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, product_variant_id, product_name_snapshot, variant_attributes_snapshot,
           unit_price, quantity, line_total, full_unit_price, bundle_id, bundle_name, subscription_months)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          orderId, item.productId, item.variantId, item.productName, item.variantAttributes,
          item.chargedUnit, item.quantity, item.lineTotal, item.currentPrice,
          item.bundleName ? item.bundleId : null, item.bundleName, item.isSubscription ? item.subscriptionMonths : null,
        ],
      );
    }

    await client.query("COMMIT");
    await logEvent({ type: "checkout", message: `Started checkout ${orderNumber} for £${p.total.toFixed(2)}`, userId, meta: { orderId } });
    return { id: orderId, orderNumber, total: p.total };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
