import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { listCategories } from "../categories/categoryRepo.js";

export const publicCategoryRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get("/categories", async (_req, reply) => {
    const categories = await listCategories();
    return reply.send({ categories });
  });
};
