import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { pool } from "../db/pool.js";

/** Serves photos kept in the database (see DatabaseStorageAdapter). They never change, so browsers keep them for a year. */
export const mediaRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get("/media/:id", { config: { rateLimit: false } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!/^[0-9a-f-]{36}$/i.test(id)) return reply.status(404).send({ error: "Not found." });
    if (req.headers["if-none-match"] === `"${id}"`) return reply.status(304).send();
    const r = await pool.query<{ content_type: string; bytes: Buffer }>(`SELECT content_type, bytes FROM media WHERE id = $1`, [id]);
    if (!r.rows[0]) return reply.status(404).send({ error: "Not found." });
    return reply
      .header("Content-Type", r.rows[0].content_type)
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .header("ETag", `"${id}"`)
      .header("X-Content-Type-Options", "nosniff")
      .header("Cross-Origin-Resource-Policy", "cross-origin")
      .send(r.rows[0].bytes);
  });
};
