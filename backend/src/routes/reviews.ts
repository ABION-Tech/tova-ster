import { pool } from "../db/pool.js";
import { logEvent } from "../events/eventsRepo.js";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { getUserFromRequest } from "../auth/session.js";
import {
  createReview,
  getProductReviews,
  getUserReviewForProduct,
  ReviewError,
} from "../reviews/reviewRepo.js";

export const reviewRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // ── GET /products/:productId/reviews ─────────────────────────────────────
  // Public. Returns approved reviews + aggregate.
  app.get("/products/:productId/reviews", async (req, reply) => {
    const { productId } = req.params as { productId: string };
    const q = req.query as { limit?: string; offset?: string };
    const limit = Math.min(Number(q.limit ?? 20), 50);
    const offset = Number(q.offset ?? 0);
    const page = await getProductReviews(productId, { limit, offset });
    return reply.send(page);
  });

  // ── GET /products/:productId/reviews/my ──────────────────────────────────
  // Returns the signed-in user's own review, or null.
  app.get("/products/:productId/reviews/my", async (req, reply) => {
    const user = await getUserFromRequest(req);
    if (!user) return reply.status(401).send({ error: "Sign in to see your review." });
    const { productId } = req.params as { productId: string };
    const review = await getUserReviewForProduct(productId, user.id);
    return reply.send({ review });
  });

  // ── POST /products/:productId/reviews ────────────────────────────────────
  // Requires auth. One review per user per product.
  app.post<{
    Params: { productId: string };
    Body: { rating: number; title?: string; body?: string };
  }>(
    "/products/:productId/reviews",
    {
      schema: {
        body: {
          type: "object",
          required: ["rating"],
          properties: {
            rating: { type: "integer", minimum: 1, maximum: 5 },
            title: { type: "string", maxLength: 120 },
            body: { type: "string", maxLength: 2000 },
          },
        },
      },
    },
    async (req, reply) => {
      const user = await getUserFromRequest(req);
      if (!user) return reply.status(401).send({ error: "Sign in to leave a review." });

      const { productId } = req.params;
      const { rating, title, body } = req.body;

      try {
        const review = await createReview({ productId, userId: user.id, rating, title, body });
        const prod = await pool.query<{ name: string }>(`SELECT name FROM products WHERE id = $1`, [productId]);
        await logEvent({ type: "review", message: `Posted a ${rating}-star review of ${prod.rows[0]?.name ?? "a product"} (waiting for approval)`, userId: user.id, meta: { productId, rating } });
        return reply.status(201).send({ review });
      } catch (err) {
        if (err instanceof ReviewError) return reply.status(400).send({ error: err.message });
        throw err;
      }
    },
  );
};
