import { pool } from "../db/pool.js";

export interface ProductRecord {
  id: string;
  category_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  base_price: string;
  discount_price: string | null;
  has_variants: boolean;
  stock: number | null;
  low_stock_threshold: number;
  status: "active" | "out_of_stock" | "draft" | "archived";
  created_at: string;
  updated_at: string;
}

export interface VariantRecord {
  id: string;
  product_id: string;
  sku: string;
  attributes: Record<string, string>;
  price: string | null;
  discount_price: string | null;
  stock: number;
  low_stock_threshold: number;
  image_url: string | null;
  status: "active" | "out_of_stock" | "draft" | "archived";
  created_at: string;
  updated_at: string;
}

export interface ProductImageRecord {
  id: string;
  product_id: string;
  product_variant_id: string | null;
  url: string;
  alt_text: string | null;
  sort_order: number;
  is_primary: boolean;
  created_at: string;
}

export interface ProductWithDetails extends ProductRecord {
  variants: VariantRecord[];
  images: ProductImageRecord[];
}

export interface ProductListFilters {
  status?: string;
  categoryId?: string;
  search?: string;
  lowStockOnly?: boolean;
}

/** A malformed slug/SKU/price never reaches the DB as a plain string typo either. */
export class ValidationError extends Error {}

function assertValidStatusTransition(status: string, hasVariants: boolean, stock: number | null, variantCount: number) {
  if (status !== "active") return;
  if (hasVariants && variantCount === 0) {
    throw new ValidationError("Cannot set status to active on a variant product with no variants yet.");
  }
  if (!hasVariants && (stock === null || stock === undefined)) {
    throw new ValidationError("Cannot set status to active on a no-variant product with no stock set.");
  }
}

export async function listProductsAdmin(filters: ProductListFilters): Promise<ProductRecord[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filters.categoryId) {
    params.push(filters.categoryId);
    conditions.push(`category_id = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(`name ILIKE $${params.length}`);
  }
  if (filters.lowStockOnly) {
    // Either the no-variant product itself is at/below threshold, or at
    // least one of its variants is — a variant product's own `stock` is
    // always NULL so it never matches the first half by accident.
    conditions.push(`(
      (has_variants = FALSE AND stock <= low_stock_threshold) OR
      (has_variants = TRUE AND EXISTS (
        SELECT 1 FROM product_variants v
        WHERE v.product_id = products.id AND v.stock <= v.low_stock_threshold
      ))
    )`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query<ProductRecord>(
    `SELECT * FROM products ${where} ORDER BY created_at DESC`,
    params,
  );
  return result.rows;
}

export async function getProductWithDetails(id: string): Promise<ProductWithDetails | null> {
  const productResult = await pool.query<ProductRecord>("SELECT * FROM products WHERE id = $1", [id]);
  const product = productResult.rows[0];
  if (!product) return null;

  const [variants, images] = await Promise.all([
    pool.query<VariantRecord>(
      "SELECT * FROM product_variants WHERE product_id = $1 ORDER BY created_at ASC",
      [id],
    ),
    pool.query<ProductImageRecord>(
      "SELECT * FROM product_images WHERE product_id = $1 ORDER BY sort_order ASC, created_at ASC",
      [id],
    ),
  ]);

  return { ...product, variants: variants.rows, images: images.rows };
}

export interface CreateProductInput {
  categoryId?: string;
  name: string;
  slug: string;
  description?: string;
  basePrice: number;
  discountPrice?: number;
  hasVariants: boolean;
  stock?: number; // required iff !hasVariants
  lowStockThreshold?: number;
  status?: ProductRecord["status"];
}

export async function createProduct(input: CreateProductInput): Promise<ProductRecord> {
  if (input.hasVariants && input.stock !== undefined) {
    throw new ValidationError("A variant product's stock lives on its variants, not on the product itself.");
  }
  if (!input.hasVariants && input.stock === undefined) {
    throw new ValidationError("stock is required for a product without variants.");
  }
  assertValidStatusTransition(input.status ?? "draft", input.hasVariants, input.stock ?? null, 0);

  const result = await pool.query<ProductRecord>(
    `INSERT INTO products (category_id, name, slug, description, base_price, discount_price, has_variants, stock, low_stock_threshold, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 5), COALESCE($10, 'draft'))
     RETURNING *`,
    [
      input.categoryId ?? null,
      input.name,
      input.slug,
      input.description ?? null,
      input.basePrice,
      input.discountPrice ?? null,
      input.hasVariants,
      input.hasVariants ? null : input.stock,
      input.lowStockThreshold ?? null,
      input.status ?? null,
    ],
  );

  const product = result.rows[0];

  if (!input.hasVariants) {
    await pool.query(
      `INSERT INTO inventory (product_id, change_type, quantity_delta, quantity_after, note)
       VALUES ($1, 'initial', $2, $2, 'Created via admin')`,
      [product.id, input.stock],
    );
  }

  return product;
}

export interface UpdateProductInput {
  categoryId?: string | null;
  name?: string;
  slug?: string;
  description?: string | null;
  basePrice?: number;
  discountPrice?: number | null;
  lowStockThreshold?: number;
  status?: ProductRecord["status"];
}

export async function updateProduct(id: string, input: UpdateProductInput): Promise<ProductRecord | null> {
  const existing = await pool.query<ProductRecord>("SELECT * FROM products WHERE id = $1", [id]);
  const current = existing.rows[0];
  if (!current) return null;

  if (input.status) {
    const variantCount = current.has_variants
      ? (await pool.query("SELECT 1 FROM product_variants WHERE product_id = $1 LIMIT 1", [id])).rowCount ?? 0
      : 0;
    assertValidStatusTransition(input.status, current.has_variants, current.stock, variantCount);
  }

  const result = await pool.query<ProductRecord>(
    `UPDATE products SET
       category_id = $2, name = $3, slug = $4, description = $5,
       base_price = $6, discount_price = $7, low_stock_threshold = $8, status = $9
     WHERE id = $1
     RETURNING *`,
    [
      id,
      input.categoryId !== undefined ? input.categoryId : current.category_id,
      input.name ?? current.name,
      input.slug ?? current.slug,
      input.description !== undefined ? input.description : current.description,
      input.basePrice ?? current.base_price,
      input.discountPrice !== undefined ? input.discountPrice : current.discount_price,
      input.lowStockThreshold ?? current.low_stock_threshold,
      input.status ?? current.status,
    ],
  );
  return result.rows[0];
}

export interface CreateVariantInput {
  sku: string;
  attributes: Record<string, string>;
  price?: number;
  discountPrice?: number;
  stock: number;
  lowStockThreshold?: number;
  imageUrl?: string;
}

export async function createVariant(productId: string, input: CreateVariantInput): Promise<VariantRecord> {
  const product = await pool.query<ProductRecord>("SELECT * FROM products WHERE id = $1", [productId]);
  if (!product.rows[0]) throw new ValidationError("Product not found.");
  if (!product.rows[0].has_variants) {
    throw new ValidationError("This product was created without variants — edit it as a no-variant product instead.");
  }

  const result = await pool.query<VariantRecord>(
    `INSERT INTO product_variants (product_id, sku, attributes, price, discount_price, stock, low_stock_threshold, image_url)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 5), $8)
     RETURNING *`,
    [
      productId,
      input.sku,
      input.attributes,
      input.price ?? null,
      input.discountPrice ?? null,
      input.stock,
      input.lowStockThreshold ?? null,
      input.imageUrl ?? null,
    ],
  );
  const variant = result.rows[0];

  await pool.query(
    `INSERT INTO inventory (product_variant_id, change_type, quantity_delta, quantity_after, note)
     VALUES ($1, 'initial', $2, $2, 'Created via admin')`,
    [variant.id, input.stock],
  );

  return variant;
}

export async function updateVariant(
  variantId: string,
  input: Partial<{
    sku: string;
    attributes: Record<string, string>;
    price: number | null;
    discountPrice: number | null;
    lowStockThreshold: number;
    imageUrl: string | null;
    status: VariantRecord["status"];
  }>,
): Promise<VariantRecord | null> {
  const existing = await pool.query<VariantRecord>("SELECT * FROM product_variants WHERE id = $1", [variantId]);
  const current = existing.rows[0];
  if (!current) return null;

  const result = await pool.query<VariantRecord>(
    `UPDATE product_variants SET
       sku = $2, attributes = $3, price = $4, discount_price = $5,
       low_stock_threshold = $6, image_url = $7, status = $8
     WHERE id = $1
     RETURNING *`,
    [
      variantId,
      input.sku ?? current.sku,
      input.attributes ?? current.attributes,
      input.price !== undefined ? input.price : current.price,
      input.discountPrice !== undefined ? input.discountPrice : current.discount_price,
      input.lowStockThreshold ?? current.low_stock_threshold,
      input.imageUrl !== undefined ? input.imageUrl : current.image_url,
      input.status ?? current.status,
    ],
  );
  return result.rows[0];
}

/**
 * Refuses to delete the last variant of a variant product — that would
 * leave `has_variants = true` with nothing to hold stock, silently
 * breaking the invariant migration 0004's CHECK constraint enforces at
 * creation time. Converting a product back to no-variant is a deliberate
 * separate action (not implemented here), not an accidental side effect
 * of deleting down to zero.
 */
export async function deleteVariant(productId: string, variantId: string): Promise<"deleted" | "not_found" | "last_variant"> {
  const count = await pool.query<{ count: string }>(
    "SELECT count(*)::int AS count FROM product_variants WHERE product_id = $1",
    [productId],
  );
  if (Number(count.rows[0]?.count ?? 0) <= 1) {
    const target = await pool.query("SELECT 1 FROM product_variants WHERE id = $1 AND product_id = $2", [
      variantId,
      productId,
    ]);
    if ((target.rowCount ?? 0) > 0) return "last_variant";
  }

  const result = await pool.query("DELETE FROM product_variants WHERE id = $1 AND product_id = $2", [
    variantId,
    productId,
  ]);
  return (result.rowCount ?? 0) > 0 ? "deleted" : "not_found";
}

export type InventoryChangeType = "restock" | "adjustment" | "return" | "sale";

/**
 * The one place stock is ever mutated post-creation: locks the row,
 * computes the new count, refuses to go negative, and writes the ledger
 * entry in the same transaction — so `products.stock`/`product_variants.stock`
 * and the `inventory` audit trail can never drift apart.
 */
export async function adjustStock(params: {
  productId: string | null;
  variantId: string | null;
  delta: number;
  changeType: InventoryChangeType;
  note?: string;
  adminUserId: string | null;
}): Promise<{ quantityAfter: number }> {
  const { productId, variantId, delta, changeType, note, adminUserId } = params;
  if ((productId === null) === (variantId === null)) {
    throw new ValidationError("Provide exactly one of productId or variantId.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const table = productId ? "products" : "product_variants";
    const id = productId ?? variantId;
    const current = await client.query<{ stock: number }>(
      `SELECT stock FROM ${table} WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!current.rows[0]) throw new ValidationError("Product or variant not found.");
    if (current.rows[0].stock === null) {
      throw new ValidationError("This product has variants — adjust stock on the variant, not the product.");
    }

    const quantityAfter = current.rows[0].stock + delta;
    if (quantityAfter < 0) {
      throw new ValidationError(`Adjustment would take stock negative (current ${current.rows[0].stock}, delta ${delta}).`);
    }

    await client.query(`UPDATE ${table} SET stock = $2 WHERE id = $1`, [id, quantityAfter]);
    await client.query(
      `INSERT INTO inventory (product_id, product_variant_id, change_type, quantity_delta, quantity_after, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [productId, variantId, changeType, delta, quantityAfter, note ?? null, adminUserId],
    );

    await client.query("COMMIT");
    return { quantityAfter };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function addProductImage(input: {
  productId: string;
  variantId?: string;
  url: string;
  altText?: string;
  isPrimary?: boolean;
  sortOrder?: number;
}): Promise<ProductImageRecord> {
  const result = await pool.query<ProductImageRecord>(
    `INSERT INTO product_images (product_id, product_variant_id, url, alt_text, is_primary, sort_order)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, 0))
     RETURNING *`,
    [
      input.productId,
      input.variantId ?? null,
      input.url,
      input.altText ?? null,
      input.isPrimary ?? false,
      input.sortOrder ?? null,
    ],
  );
  return result.rows[0];
}

export async function findProductImage(imageId: string): Promise<ProductImageRecord | null> {
  const result = await pool.query<ProductImageRecord>("SELECT * FROM product_images WHERE id = $1", [imageId]);
  return result.rows[0] ?? null;
}

export async function deleteProductImageRow(imageId: string): Promise<boolean> {
  const result = await pool.query("DELETE FROM product_images WHERE id = $1", [imageId]);
  return (result.rowCount ?? 0) > 0;
}
