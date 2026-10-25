import { pool } from "../db/pool.js";
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { getUserFromRequest } from "../auth/session.js";
import { getOrCreateCart } from "../cart/cartService.js";
import {
  getCartSummary, addCartItem, addBundle, addQuizSet, updateCartItemQuantity, setItemSubscription,
  removeCartItem, clearCart, setCartCode, setRedeemPoints, rememberOnCart, CartItemError,
} from "../cart/cartItemsRepo.js";
import { logEvent } from "../events/eventsRepo.js";

const uuid = { type: "string", format: "uuid" } as const;

/**
 * Every route resolves "your basket" via getOrCreateCart (session cookie or
 * guest cookie) — the client never supplies a cart id. The guest cookie lasts
 * 90 days, so a basket is still there when someone comes back next week.
 */
export const cartRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  async function withCart(
    req: FastifyRequest,
    reply: FastifyReply,
    fn: (cartId: string, userId: string | null) => Promise<unknown>,
    status = 200,
  ) {
    const user = await getUserFromRequest(req);
    const cart = await getOrCreateCart(req, reply, user);
    try {
      const out = await fn(cart.id, user?.id ?? null);
      if (typeof out === "string") return reply.status(400).send({ error: out }); // a shopper-facing problem
    } catch (err) {
      if (err instanceof CartItemError) {
        // Wanted something we couldn't sell: worth knowing for restocking.
        if (/stock/i.test(err.message)) await logEvent({ type: "basket", message: `Couldn't add to basket: ${err.message}`, userId: user?.id ?? null, meta: { problem: "stock", detail: err.message } });
        return reply.status(400).send({ error: err.message });
      }
      throw err;
    }
    const summary = await getCartSummary(cart.id);
    return reply.status(status).send({ cart: { id: cart.id, ...summary } });
  }

  app.get("/cart", (req, reply) => withCart(req, reply, async () => undefined));

  app.post("/cart/items", {
    schema: { body: { type: "object", required: ["productId", "quantity"], additionalProperties: false, properties: {
      productId: uuid, variantId: uuid, quantity: { type: "integer", minimum: 1, maximum: 50 },
      subscriptionMonths: { type: ["integer", "null"], minimum: 1, maximum: 12 },
    } } },
  }, (req, reply) => withCart(req, reply, async (cartId, userId) => {
    const body = req.body as { productId: string; variantId?: string; quantity: number; subscriptionMonths?: number | null };
    await addCartItem(cartId, body);
    await logEvent({ type: "basket", message: `Added to basket${body.subscriptionMonths ? " (Subscribe & Save)" : ""}`, userId, meta: { productId: body.productId, qty: body.quantity } });
  }, 201));

  app.post("/cart/bundles", {
    schema: { body: { type: "object", required: ["bundleId"], additionalProperties: false, properties: { bundleId: uuid, quantity: { type: "integer", minimum: 1, maximum: 20 } } } },
  }, (req, reply) => withCart(req, reply, async (cartId, userId) => {
    const { bundleId, quantity } = req.body as { bundleId: string; quantity?: number };
    await addBundle(cartId, bundleId, quantity ?? 1);
    await logEvent({ type: "basket", message: "Added a bundle to basket", userId, meta: { bundleId } });
  }, 201));

  app.post("/cart/quiz-set", {
    schema: { body: { type: "object", required: ["productIds"], additionalProperties: false, properties: { productIds: { type: "array", items: uuid, minItems: 1, maxItems: 10 } } } },
  }, (req, reply) => withCart(req, reply, async (cartId, userId) => {
    const { productIds } = req.body as { productIds: string[] };
    await addQuizSet(cartId, productIds);
    await logEvent({ type: "quiz", message: `Added a quiz set of ${productIds.length} to basket`, userId, meta: { productIds } });
  }, 201));

  app.patch("/cart/items/:itemId", {
    schema: {
      params: { type: "object", properties: { itemId: uuid } },
      body: { type: "object", additionalProperties: false, minProperties: 1, properties: {
        quantity: { type: "integer", minimum: 1, maximum: 50 },
        subscriptionMonths: { type: ["integer", "null"], minimum: 1, maximum: 12 },
      } },
    },
  }, (req, reply) => withCart(req, reply, async (cartId) => {
    const { itemId } = req.params as { itemId: string };
    const body = req.body as { quantity?: number; subscriptionMonths?: number | null };
    if (body.subscriptionMonths !== undefined) await setItemSubscription(cartId, itemId, body.subscriptionMonths);
    if (body.quantity !== undefined) await updateCartItemQuantity(cartId, itemId, body.quantity);
  }));

  app.delete("/cart/items/:itemId", {
    schema: { params: { type: "object", properties: { itemId: uuid } } },
  }, (req, reply) => withCart(req, reply, async (cartId, userId) => {
    const { itemId } = req.params as { itemId: string };
    const what = await pool.query<{ name: string | null; bundle: string | null; quantity: number }>(
      `SELECT p.name, b.name AS bundle, ci.quantity FROM cart_items ci LEFT JOIN products p ON p.id = ci.product_id LEFT JOIN bundles b ON b.id = ci.bundle_id
       WHERE ci.id = $1 AND ci.cart_id = $2`, [itemId, cartId]);
    if (!(await removeCartItem(cartId, itemId))) throw new CartItemError("Basket item not found.");
    const w = what.rows[0];
    await logEvent({ type: "basket", message: `Removed ${w?.bundle ? `the ${w.bundle} bundle` : w?.name ?? "an item"} from basket`, userId, meta: { itemId, product: w?.name ?? null, bundle: w?.bundle ?? null, qty: w?.quantity ?? null } });
  }));

  app.post("/cart/clear", (req, reply) => withCart(req, reply, (cartId) => clearCart(cartId)));

  app.put("/cart/code", {
    schema: { body: { type: "object", required: ["code"], additionalProperties: false, properties: { code: { type: ["string", "null"], maxLength: 40 } } } },
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } }, // stops code guessing
  }, (req, reply) => withCart(req, reply, async (cartId) => setCartCode(cartId, (req.body as { code: string | null }).code)));

  app.put("/cart/points", {
    schema: { body: { type: "object", required: ["redeem"], additionalProperties: false, properties: { redeem: { type: "boolean" } } } },
  }, (req, reply) => withCart(req, reply, async (cartId, userId) => {
    if (!userId) return "Sign in to use your points.";
    await setRedeemPoints(cartId, (req.body as { redeem: boolean }).redeem);
  }));

  // Remember the postcode (real delivery price on the next visit) and email (basket reminders).
  app.put("/cart/remember", {
    schema: { body: { type: "object", additionalProperties: false, minProperties: 1, properties: {
      postcode: { type: ["string", "null"], maxLength: 10 }, email: { type: ["string", "null"], maxLength: 200 },
    } } },
  }, (req, reply) => withCart(req, reply, async (cartId) => rememberOnCart(cartId, req.body as { postcode?: string | null; email?: string | null })));
};
