import { pool } from "../db/pool.js";
import { logAdmin, logEvent } from "../events/eventsRepo.js";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { requireAdmin } from "../auth/adminSession.js";
import { listReviewsForAdmin, updateReviewStatus, ReviewError } from "../reviews/reviewRepo.js";

export const adminReviewRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // GET /admin/reviews?status=approved|rejected|all&limit=50&offset=0
  app.get("/admin/reviews", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;
    const q = req.query as { status?: string; limit?: string; offset?: string };
    const limit = Math.min(Number(q.limit ?? 50), 100);
    const offset = Number(q.offset ?? 0);
    const status = q.status && q.status !== "all" ? q.status : undefined;
    const result = await listReviewsForAdmin({ status, limit, offset });
    return reply.send(result);
  });

  // PATCH /admin/reviews/:id/status — approve or reject
  app.patch<{ Params: { id: string }; Body: { status: "approved" | "rejected" } }>(
    "/admin/reviews/:id/status",
    {
      schema: {
        body: {
          type: "object",
          required: ["status"],
          properties: { status: { type: "string", enum: ["approved", "rejected"] } },
        },
      },
    },
    async (req, reply) => {
      const admin = await requireAdmin(req, reply);
      if (!admin) return;
      try {
        await updateReviewStatus(req.params.id, req.body.status);
        const r = await pool.query<{ user_id: string; rating: number; name: string }>(
          `SELECT r.user_id, r.rating, p.name FROM product_reviews r JOIN products p ON p.id = r.product_id WHERE r.id = $1`, [req.params.id]);
        const row = r.rows[0];
        if (row) {
          await logEvent({ type: "review", message: `${row.rating}-star review of ${row.name} ${req.body.status}`, userId: row.user_id, meta: { reviewId: req.params.id, status: req.body.status } });
          await logAdmin(admin.id, `${admin.name} ${req.body.status} a review of ${row.name}`, { reviewId: req.params.id });
        }
        return reply.send({ ok: true });
      } catch (err) {
        if (err instanceof ReviewError) return reply.status(404).send({ error: err.message });
        throw err;
      }
    },
  );
};
