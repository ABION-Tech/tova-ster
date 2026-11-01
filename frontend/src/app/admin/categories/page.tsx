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
    <>
      <div className="ahead"><div><h1>Categories</h1><p>Groups used to organise products in the shop.</p></div></div>

      <form onSubmit={handleCreate} className="acard">
        <h2>Add a category</h2>
        <div className="formgrid">
          <label className="fld">Name<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
          <label className="fld">Web address name (slug)<input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-"))} required /></label>
          <label className="fld">Inside another category
            <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">No, top level</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <div className="fld" style={{ alignContent: "end" }}><button type="submit" className="btn sm">Add category</button></div>
        </div>
      </form>
      {error && <div className="notice warn" role="alert">{error}</div>}

      <div className="acard">
        {loading ? <p className="muted">Loading categories…</p> : (
          <div className="tscroll">
            <table className="t">
              <thead><tr><th>Name</th><th>Slug</th><th>Inside</th><th /></tr></thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.id}>
                    <td><b>{c.name}</b></td>
                    <td className="muted">{c.slug}</td>
                    <td>{categories.find((p) => p.id === c.parent_id)?.name ?? "–"}</td>
                    <td className="r"><button onClick={() => handleDelete(c.id)} className="btn ghost sm danger">Delete</button></td>
                  </tr>
                ))}
                {categories.length === 0 && <tr><td colSpan={4} className="muted">No categories yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
