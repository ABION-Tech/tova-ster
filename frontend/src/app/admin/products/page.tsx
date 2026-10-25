"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { adminJson } from "../../../lib/backend";

interface Category {
  id: string;
  name: string;
}

interface Product {
  id: string;
  name: string;
  slug: string;
  status: string;
  has_variants: boolean;
  stock: number | null;
  base_price: string;
}

export default function AdminProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    slug: "",
    categoryId: "",
    basePrice: "",
    hasVariants: false,
    stock: "",
    description: "",
  });

  async function loadProducts() {
    const qs = lowStockOnly ? "?lowStock=true" : "";
    const data = await adminJson<{ products: Product[] }>(`/admin/products${qs}`);
    setProducts(data.products);
  }

  async function loadCategories() {
    const data = await adminJson<{ categories: Category[] }>("/admin/categories");
    setCategories(data.categories);
  }

  useEffect(() => {
    Promise.all([loadProducts(), loadCategories()]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lowStockOnly]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await adminJson("/admin/products", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          slug: form.slug,
          categoryId: form.categoryId || undefined,
          basePrice: Number(form.basePrice),
          hasVariants: form.hasVariants,
          stock: form.hasVariants ? undefined : Number(form.stock),
          description: form.description || undefined,
        }),
      });
      setForm({ name: "", slug: "", categoryId: "", basePrice: "", hasVariants: false, stock: "", description: "" });
      await loadProducts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create product.");
    }
  }

  return (
    <main>
      <h1 className="display-3" style={{ marginBottom: 20 }}>Products</h1>

      <details style={{ marginBottom: 24 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>New product</summary>
        <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 420, marginTop: 12 }}>
          <label>
            Name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="input" />
          </label>
          <label>
            Slug
            <input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} required className="input" />
          </label>
          <label>
            Category
            <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} className="input">
              <option value="">— none —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Base price (£)
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.basePrice}
              onChange={(e) => setForm({ ...form, basePrice: e.target.value })}
              required
              className="input"
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.hasVariants}
              onChange={(e) => setForm({ ...form, hasVariants: e.target.checked })}
            />{" "}
            Has variants (size/colour/etc — add variants after creating)
          </label>
          {!form.hasVariants && (
            <label>
              Stock
              <input
                type="number"
                min="0"
                value={form.stock}
                onChange={(e) => setForm({ ...form, stock: e.target.value })}
                required
                className="input"
              />
            </label>
          )}
          <label>
            Description
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input" rows={3} style={{ resize: "vertical" }} />
          </label>
          <button type="submit" className="btn btn-primary btn-sm">Create product</button>
        </form>
      </details>
      {error && <p style={{ color: "var(--danger-text)" }}>{error}</p>}

      <label style={{ display: "block", marginBottom: 12 }}>
        <input type="checkbox" checked={lowStockOnly} onChange={(e) => setLowStockOnly(e.target.checked)} /> Low stock
        only
      </label>

      {loading ? (
        <p style={{ color: "var(--ink-muted)" }}>Loading products…</p>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={cellStyle}>Name</th>
              <th style={cellStyle}>Status</th>
              <th style={cellStyle}>Price</th>
              <th style={cellStyle}>Stock</th>
              <th style={cellStyle}></th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td style={cellStyle}>{p.name}</td>
                <td style={cellStyle}>{p.status}</td>
                <td style={cellStyle}>£{p.base_price}</td>
                <td style={cellStyle}>{p.has_variants ? "— (per variant)" : p.stock}</td>
                <td style={cellStyle}>
                  <Link href={`/admin/products/${p.id}`} style={{ color: "var(--gold-deep)", fontWeight: 600 }}>Edit</Link>
                </td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr>
                <td style={cellStyle} colSpan={5}>
                  No products{lowStockOnly ? " below their low-stock threshold" : " yet"}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </main>
  );
}

const cellStyle: React.CSSProperties = { border: "1px solid var(--line)", padding: 8, textAlign: "left" };
