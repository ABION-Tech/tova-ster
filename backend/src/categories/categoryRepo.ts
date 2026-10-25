import { pool } from "../db/pool.js";

export interface CategoryRecord {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export async function listCategories(): Promise<CategoryRecord[]> {
  const result = await pool.query<CategoryRecord>("SELECT * FROM categories ORDER BY name ASC");
  return result.rows;
}

export async function createCategory(input: {
  name: string;
  slug: string;
  description?: string;
  parentId?: string;
}): Promise<CategoryRecord> {
  const result = await pool.query<CategoryRecord>(
    `INSERT INTO categories (name, slug, description, parent_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [input.name, input.slug, input.description ?? null, input.parentId ?? null],
  );
  return result.rows[0];
}

export async function updateCategory(
  id: string,
  input: Partial<{ name: string; slug: string; description: string | null; parentId: string | null }>,
): Promise<CategoryRecord | null> {
  const existing = await pool.query<CategoryRecord>("SELECT * FROM categories WHERE id = $1", [id]);
  const current = existing.rows[0];
  if (!current) return null;

  const result = await pool.query<CategoryRecord>(
    `UPDATE categories SET name = $2, slug = $3, description = $4, parent_id = $5
     WHERE id = $1
     RETURNING *`,
    [
      id,
      input.name ?? current.name,
      input.slug ?? current.slug,
      input.description !== undefined ? input.description : current.description,
      input.parentId !== undefined ? input.parentId : current.parent_id,
    ],
  );
  return result.rows[0];
}

// Products referencing this category have category_id ON DELETE SET NULL
// (migration 0004) — deleting a category un-categorizes its products
// rather than failing or cascading, since "category deleted" isn't reason
// enough to also hide the products in it.
export async function deleteCategory(id: string): Promise<boolean> {
  const result = await pool.query("DELETE FROM categories WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
}
