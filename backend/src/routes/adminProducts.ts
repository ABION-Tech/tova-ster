import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { requireAdmin } from "../auth/adminSession.js";
import { storageService } from "../services/storage/index.js";
import {
  listProductsAdmin,
  getProductWithDetails,
  createProduct,
  updateProduct,
  createVariant,
  updateVariant,
  deleteVariant,
  adjustStock,
  addProductImage,
  findProductImage,
  deleteProductImageRow,
  ValidationError,
  type InventoryChangeType,
} from "../products/productRepo.js";

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

/** Shared by every handler below: ValidationError -> 400, unique-slug/SKU clash -> 409, else rethrow. */
async function handle<T>(reply: import("fastify").FastifyReply, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ValidationError) {
      reply.status(400).send({ error: err.message });
      return undefined;
    }
    if (isUniqueViolation(err)) {
      reply.status(409).send({ error: "That slug/SKU is already in use." });
      return undefined;
    }
    throw err;
  }
}

export const adminProductRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get("/admin/products", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;

    const query = req.query as { status?: string; categoryId?: string; search?: string; lowStock?: string };
    const products = await listProductsAdmin({
      status: query.status,
      categoryId: query.categoryId,
      search: query.search,
      lowStockOnly: query.lowStock === "true",
    });
    return reply.send({ products });
  });

  app.get("/admin/products/:id", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;

    const { id } = req.params as { id: string };
    const product = await getProductWithDetails(id);
    if (!product) return reply.status(404).send({ error: "Product not found." });
    return reply.send({ product });
  });

  app.post(
    "/admin/products",
    {
      schema: {
        body: {
          type: "object",
          required: ["name", "slug", "basePrice", "hasVariants"],
          properties: {
            categoryId: { type: "string" },
            name: { type: "string", minLength: 1 },
            slug: { type: "string", minLength: 1 },
            description: { type: "string" },
            basePrice: { type: "number", minimum: 0 },
            discountPrice: { type: "number", minimum: 0 },
            hasVariants: { type: "boolean" },
            stock: { type: "integer", minimum: 0 },
            lowStockThreshold: { type: "integer", minimum: 0 },
            status: { type: "string", enum: ["active", "out_of_stock", "draft", "archived"] },
          },
        },
      },
    },
    async (req, reply) => {
      const admin = await requireAdmin(req, reply);
      if (!admin) return;

      const product = await handle(reply, () => createProduct(req.body as Parameters<typeof createProduct>[0]));
      if (product === undefined) return;
      return reply.status(201).send({ product });
    },
  );

  app.patch("/admin/products/:id", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;

    const { id } = req.params as { id: string };
    const updated = await handle(reply, () => updateProduct(id, req.body as Parameters<typeof updateProduct>[1]));
    if (updated === undefined) return;
    if (!updated) return reply.status(404).send({ error: "Product not found." });
    return reply.send({ product: updated });
  });

  app.post(
    "/admin/products/:id/variants",
    {
      schema: {
        body: {
          type: "object",
          required: ["sku", "attributes", "stock"],
          properties: {
            sku: { type: "string", minLength: 1 },
            attributes: { type: "object" },
            price: { type: "number", minimum: 0 },
            discountPrice: { type: "number", minimum: 0 },
            stock: { type: "integer", minimum: 0 },
            lowStockThreshold: { type: "integer", minimum: 0 },
            imageUrl: { type: "string" },
          },
        },
      },
    },
    async (req, reply) => {
      const admin = await requireAdmin(req, reply);
      if (!admin) return;

      const { id } = req.params as { id: string };
      const variant = await handle(reply, () =>
        createVariant(id, req.body as Parameters<typeof createVariant>[1]),
      );
      if (variant === undefined) return;
      return reply.status(201).send({ variant });
    },
  );

  app.patch("/admin/products/:id/variants/:variantId", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;

    const { variantId } = req.params as { id: string; variantId: string };
    const updated = await handle(reply, () =>
      updateVariant(variantId, req.body as Parameters<typeof updateVariant>[1]),
    );
    if (updated === undefined) return;
    if (!updated) return reply.status(404).send({ error: "Variant not found." });
    return reply.send({ variant: updated });
  });

  app.delete("/admin/products/:id/variants/:variantId", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;

    const { id, variantId } = req.params as { id: string; variantId: string };
    const result = await deleteVariant(id, variantId);
    if (result === "not_found") return reply.status(404).send({ error: "Variant not found." });
    if (result === "last_variant") {
      return reply
        .status(400)
        .send({ error: "Can't delete the last variant of a variant product. Archive the product instead." });
    }
    return reply.send({ ok: true });
  });

  app.post(
    "/admin/products/:id/inventory",
    {
      schema: {
        body: {
          type: "object",
          required: ["delta", "changeType"],
          properties: {
            variantId: { type: "string" },
            delta: { type: "integer" },
            changeType: { type: "string", enum: ["restock", "adjustment", "return"] },
            note: { type: "string" },
          },
        },
      },
    },
    async (req, reply) => {
      const admin = await requireAdmin(req, reply);
      if (!admin) return;

      const { id } = req.params as { id: string };
      const body = req.body as { variantId?: string; delta: number; changeType: InventoryChangeType; note?: string };

      const result = await handle(reply, () =>
        adjustStock({
          productId: body.variantId ? null : id,
          variantId: body.variantId ?? null,
          delta: body.delta,
          changeType: body.changeType,
          note: body.note,
          adminUserId: admin.id,
        }),
      );
      if (result === undefined) return;
      return reply.send(result);
    },
  );

  // multipart/form-data: fields `file` (the image) and optionally
  // `variantId`, `altText`, `isPrimary`. Goes through StorageService only —
  // this route never sees a Cloudinary type.
  app.post("/admin/products/:id/images", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;

    const { id } = req.params as { id: string };
    const data = await req.file();
    if (!data) return reply.status(400).send({ error: "No file uploaded (expected multipart field 'file')." });

    const buffer = await data.toBuffer();
    const fields = data.fields as Record<string, { value?: string } | undefined>;
    const variantId = fields.variantId?.value;
    const altText = fields.altText?.value;
    const isPrimary = fields.isPrimary?.value === "true";

    const upload = await handle(reply, () => storageService.upload(buffer, { folder: `wellness-ecom/products/${id}` }));
    if (upload === undefined) return;

    const image = await addProductImage({
      productId: id,
      variantId,
      url: upload.url,
      altText,
      isPrimary,
    });
    return reply.status(201).send({ image });
  });

  app.delete("/admin/products/:id/images/:imageId", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;

    const { imageId } = req.params as { id: string; imageId: string };
    const image = await findProductImage(imageId);
    if (!image) return reply.status(404).send({ error: "Image not found." });

    // Best-effort vendor cleanup: if Cloudinary isn't configured yet (dev
    // without real creds) or the delete call fails, the DB row still goes —
    // an orphaned remote file is a cheap, fixable problem; a product that
    // can't remove a broken image reference is not.
    try {
      const publicId = extractPublicId(image.url);
      if (publicId) await storageService.delete(publicId);
    } catch (err) {
      req.log.warn(err, "failed to delete image from storage provider; removing DB row anyway");
    }

    await deleteProductImageRow(imageId);
    return reply.send({ ok: true });
  });
};

function extractPublicId(url: string): string | null {
  // Cloudinary URLs: .../upload/v169.../wellness-ecom/products/<id>/<public_id>.<ext>
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+$/);
  return match ? match[1] : null;
}
