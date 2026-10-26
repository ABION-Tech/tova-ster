"use client";

import { useEffect, useState } from "react";
import { adminJson } from "../../../lib/backend";

interface Category {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  description: string | null;
}

export default function AdminCategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [parentId, setParentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    const data = await adminJson<{ categories: Category[] }>("/admin/categories");
    setCategories(data.categories);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await adminJson("/admin/categories", {
        method: "POST",
        body: JSON.stringify({ name, slug, parentId: parentId || undefined }),
      });
      setName("");
      setSlug("");
      setParentId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create category.");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this category? Products in it will become uncategorized, not deleted.")) return;
    setError(null);
    try {
      await adminJson(`/admin/categories/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete category.");
    }
  }

  return (
    <div>
      <h1 className="display-3" style={{ marginBottom: 20 }}>Categories</h1>

      <form onSubmit={handleCreate} style={{ display: "flex", gap: 8, alignItems: "end", marginBottom: 24 }}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required className="input" style={{ display: "block" }} />
        </label>
        <label>
          Slug
          <input value={slug} onChange={(e) => setSlug(e.target.value)} required className="input" style={{ display: "block" }} />
        </label>
        <label>
          Parent category
          <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="input" style={{ display: "block" }}>
            <option value="">— none —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-primary btn-sm">Add category</button>
      </form>
      {error && <p style={{ color: "var(--danger-text)" }}>{error}</p>}

      {loading ? (
        <p style={{ color: "var(--ink-muted)" }}>Loading categories…</p>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={cellStyle}>Name</th>
              <th style={cellStyle}>Slug</th>
              <th style={cellStyle}>Parent</th>
              <th style={cellStyle}></th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id}>
                <td style={cellStyle}>{c.name}</td>
                <td style={cellStyle}>{c.slug}</td>
                <td style={cellStyle}>{categories.find((p) => p.id === c.parent_id)?.name ?? "—"}</td>
                <td style={cellStyle}>
                  <button onClick={() => handleDelete(c.id)} className="btn btn-outline btn-sm" style={{ color: "var(--danger-text)" }}>Delete</button>
                </td>
              </tr>
            ))}
            {categories.length === 0 && (
              <tr>
                <td style={cellStyle} colSpan={4}>No categories yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

const cellStyle: React.CSSProperties = { border: "1px solid var(--line)", padding: 8, textAlign: "left" };
