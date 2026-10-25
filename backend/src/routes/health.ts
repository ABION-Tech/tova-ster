import type { FastifyInstance } from "fastify";
import { pingDb } from "../db/pool.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    let dbOk = false;
    let dbError: string | undefined;
    try {
      dbOk = await pingDb();
    } catch (err) {
      dbError = err instanceof Error ? err.message : "unknown db error";
    }

    return {
      status: "ok",
      env: process.env.NODE_ENV ?? "unknown",
      db: dbOk ? "ok" : "unreachable",
      dbError,
      timestamp: new Date().toISOString(),
    };
  });
}
