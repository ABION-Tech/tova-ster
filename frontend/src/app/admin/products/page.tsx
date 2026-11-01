"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { adminJson } from "../../../lib/backend";
import { canEdit, useAdmin } from "../../../lib/admin/AdminContext";

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
  discount_price?: string | null;
  low_stock_threshold?: number | null;
  image_url?: string | null;
}

const STATUS: Record<string, [string, string]> = {
  active: ["On sale", "active"], out_of_stock: ["Sold out", "low"], draft: ["Draft", "paused"], archived: ["Archived", "paused"],
};

export default function AdminProductsPage() {
  const { admin } = useAdmin();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [q, setQ] = useState("");
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

  const shown = products.filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()));
  const editable = canEdit(admin?.role, "products");

  return (
    <>
      <div className="ahead">
        <div><h1>Products</h1><p>{products.length} product{products.length === 1 ? "" : "s"}. Open one to change its price, stock, wording or photos.</p></div>
        {editable && <button className="btn sm" onClick={() => setShowNew((v) => !v)} aria-expanded={showNew}>{showNew ? "Close" : "New product"}</button>}
      </div>

      {editable && showNew && (
        <form className="acard" onSubmit={handleCreate}>
          <h2>New product</h2>
          <div className="formgrid">
            <label className="fld">Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, slug: form.slug || "" })} required /></label>
            <label className="fld">Web address name (slug)<input value={form.slug} placeholder="e.g. vitamin-c-gummies" onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-") })} required /></label>
            <label className="fld">Category
              <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                <option value="">None</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="fld">Price (£, including VAT)<input type="number" min="0" step="0.01" inputMode="decimal" value={form.basePrice} onChange={(e) => setForm({ ...form, basePrice: e.target.value })} required /></label>
            {!form.hasVariants && <label className="fld">Stock<input type="number" min="0" inputMode="numeric" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} required /></label>}
            <label className="fld wide">Description<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} /></label>
          </div>
          <label className="check"><input type="checkbox" checked={form.hasVariants} onChange={(e) => setForm({ ...form, hasVariants: e.target.checked })} /> Sold in versions (sizes or flavours), added after creating</label>
          <div className="frow" style={{ justifyContent: "flex-start" }}>
            <button type="submit" className="btn sm">Create product</button>
            <span className="muted">New products start as drafts until you put them on sale.</span>
          </div>
        </form>
      )}
      {error && <div className="notice warn" role="alert">{error}</div>}

      <div className="acard">
        <div className="toolrow">
          <input className="ain wide" type="search" placeholder="Search products" aria-label="Search products" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="chips">
            <button type="button" className="chip" aria-pressed={!lowStockOnly} onClick={() => setLowStockOnly(false)}>All</button>
            <button type="button" className="chip" aria-pressed={lowStockOnly} onClick={() => setLowStockOnly(true)}>Low stock</button>
          </div>
        </div>
        {loading ? <p className="muted">Loading products…</p> : (
          <div className="tscroll">
            <table className="t">
              <thead><tr><th>Product</th><th>Status</th><th className="r">Price</th><th className="r">Stock</th><th /></tr></thead>
              <tbody>
                {shown.map((p) => {
                  const [label, cls] = STATUS[p.status] ?? [p.status, "paused"];
                  const low = !p.has_variants && p.stock !== null && p.low_stock_threshold != null && p.stock <= p.low_stock_threshold;
                  return (
                    <tr key={p.id}>
                      <td>
                        <Link href={`/admin/products/${p.id}`} className="cellflex prodcell">
                          <span className="mini-th">{p.image_url ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={p.image_url} alt="" /> : null}</span>
                          <b>{p.name}</b>
                        </Link>
                      </td>
                      <td><span className={`pill ${cls}`}>{label}</span></td>
                      <td className="r">£{Number(p.base_price).toFixed(2)}{p.discount_price ? <><br /><small className="muted">sale £{Number(p.discount_price).toFixed(2)}</small></> : null}</td>
                      <td className="r">{p.has_variants ? <span className="muted">per version</span> : low ? <span className="pill low">{p.stock} left</span> : p.stock}</td>
                      <td className="r"><Link className="btn ghost sm" href={`/admin/products/${p.id}`}>{editable ? "Edit" : "View"}</Link></td>
                    </tr>
                  );
                })}
                {shown.length === 0 && <tr><td colSpan={5} className="muted">No products{lowStockOnly ? " at or below their low-stock level" : q ? " match that search" : " yet"}.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

