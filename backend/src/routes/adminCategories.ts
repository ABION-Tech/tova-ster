import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { requireAdmin } from "../auth/adminSession.js";
import { listCategories, createCategory, updateCategory, deleteCategory } from "../categories/categoryRepo.js";

export const adminCategoryRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get("/admin/categories", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;

    const categories = await listCategories();
    return reply.send({ categories });
  });

  app.post(
    "/admin/categories",
    {
      schema: {
        body: {
          type: "object",
          required: ["name", "slug"],
          properties: {
            name: { type: "string", minLength: 1 },
            slug: { type: "string", minLength: 1 },
            description: { type: "string" },
            parentId: { type: "string" },
          },
        },
      },
    },
    async (req, reply) => {
      const admin = await requireAdmin(req, reply);
      if (!admin) return;

      try {
        const category = await createCategory(
          req.body as { name: string; slug: string; description?: string; parentId?: string },
        );
        return reply.status(201).send({ category });
      } catch (err) {
        if (isUniqueViolation(err)) {
          return reply.status(409).send({ error: "A category with that slug already exists." });
        }
        throw err;
      }
    },
  );

  app.patch("/admin/categories/:id", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;

    const { id } = req.params as { id: string };
    try {
      const category = await updateCategory(
        id,
        req.body as Partial<{ name: string; slug: string; description: string | null; parentId: string | null }>,
      );
      if (!category) return reply.status(404).send({ error: "Category not found." });
      return reply.send({ category });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.status(409).send({ error: "A category with that slug already exists." });
      }
      throw err;
    }
  });

  app.delete("/admin/categories/:id", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;

    const { id } = req.params as { id: string };
    const deleted = await deleteCategory(id);
    if (!deleted) return reply.status(404).send({ error: "Category not found." });
    return reply.send({ ok: true });
  });
};

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}
