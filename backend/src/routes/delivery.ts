import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { computeDelivery, UnsupportedDestinationError } from "../services/delivery/index.js";
import { pricingContext } from "../pricing/context.js";

export const deliveryRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // GET /delivery/estimate?postcode=SW1A1AA&subtotal=32.50
  // Shows the real delivery fee before the customer submits. Public information.
  app.get("/delivery/estimate", async (req, reply) => {
    const { postcode, subtotal } = req.query as { postcode?: string; subtotal?: string };
    if (!postcode?.trim()) return reply.status(400).send({ error: "postcode is required." });
    try {
      const { rates } = await pricingContext();
      const quote = computeDelivery(postcode, Number(subtotal) || 0, rates);
      return reply.send({ ...quote, currency: "GBP" });
    } catch (err) {
      if (err instanceof UnsupportedDestinationError) return reply.status(422).send({ error: err.message });
      throw err;
    }
  });
};
