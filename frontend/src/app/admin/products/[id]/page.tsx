"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { adminFetch, adminJson } from "../../../../lib/backend";
import { canEdit, useAdmin } from "../../../../lib/admin/AdminContext";

interface Variant {
  id: string;
  sku: string;
  attributes: Record<string, string>;
  price: string | null;
  stock: number;
  status: string;
}

interface ProductImage {
  id: string;
  url: string;
  product_variant_id: string | null;
  is_primary: boolean;
}

interface Product {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  base_price: string;
  discount_price: string | null;
  has_variants: boolean;
  stock: number | null;
  status: string;
  variants: Variant[];
  images: ProductImage[];
}

export default function AdminProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { admin } = useAdmin();
  const mayEdit = canEdit(admin?.role, "products");
  const mayStock = canEdit(admin?.role, "stock");
  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const data = await adminJson<{ product: Product }>(`/admin/products/${id}`);
    setProduct(data.product);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!product) return <p style={{ color: "var(--ink-muted)" }}>Loading product…</p>;

  async function withError(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <main style={{ maxWidth: 720, display: "flex", flexDirection: "column", gap: 4 }}>
      <p>
        <a href="/admin/products">← All products</a>
      </p>
      <h1>{product.name}</h1>
      {error && <p style={{ color: "var(--danger-text)" }}>{error}</p>}

      {!mayEdit && (
        <p style={{ padding: 12, borderRadius: 8, background: "#F4EAD3", fontSize: 13 }}>
          View only for your role ({admin?.role}).{mayStock ? " You can update stock below." : ""}
        </p>
      )}
      <fieldset disabled={!mayEdit} style={{ border: 0, padding: 0, margin: 0 }}>
        <EditProductForm product={product} onSaved={load} withError={withError} />
      </fieldset>

      <hr style={{ margin: "24px 0" }} />

      {product.has_variants ? (
        <fieldset disabled={!mayEdit} style={{ border: 0, padding: 0, margin: 0 }}>
          <VariantsSection product={product} onChanged={load} withError={withError} />
        </fieldset>
      ) : (
        <fieldset disabled={!mayStock} style={{ border: 0, padding: 0, margin: 0 }}>
          <StockAdjustSection productId={product.id} currentStock={product.stock} onChanged={load} withError={withError} />
        </fieldset>
      )}

      <hr style={{ margin: "24px 0" }} />

      <fieldset disabled={!mayEdit} style={{ border: 0, padding: 0, margin: 0 }}>
        <ImagesSection product={product} onChanged={load} withError={withError} />
      </fieldset>
    </main>
  );
}

function EditProductForm({
  product,
  onSaved,
  withError,
}: {
  product: Product;
  onSaved: () => Promise<void>;
  withError: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [name, setName] = useState(product.name);
  const [basePrice, setBasePrice] = useState(product.base_price);
  const [discountPrice, setDiscountPrice] = useState(product.discount_price ?? "");
  const [description, setDescription] = useState(product.description ?? "");
  const [status, setStatus] = useState(product.status);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await withError(async () => {
      await adminJson(`/admin/products/${product.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          basePrice: Number(basePrice),
          discountPrice: discountPrice === "" ? null : Number(discountPrice),
          description,
          status,
        }),
      });
      await onSaved();
    });
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 460 }}>
      <h2 className="display-3">Details</h2>
      <label className="field-label">
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} className="input" />
      </label>
      <label>
        Base price (£)
        <input type="number" min="0" step="0.01" value={basePrice} onChange={(e) => setBasePrice(e.target.value)} className="input" />
      </label>
      <label>
        Discount price (£, optional)
        <input type="number" min="0" step="0.01" value={discountPrice} onChange={(e) => setDiscountPrice(e.target.value)} className="input" />
      </label>
      <label>
        Description
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="input" rows={4} style={{ resize: "vertical" }} />
      </label>
      <label>
        Status
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="input">
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="out_of_stock">Out of stock</option>
          <option value="archived">Archived</option>
        </select>
      </label>
      <button type="submit" className="btn btn-primary btn-sm">Save details</button>
    </form>
  );
}

function StockAdjustSection({
  productId,
  currentStock,
  onChanged,
  withError,
}: {
  productId: string;
  currentStock: number | null;
  onChanged: () => Promise<void>;
  withError: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [delta, setDelta] = useState("");
  const [changeType, setChangeType] = useState<"restock" | "adjustment" | "return">("restock");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await withError(async () => {
      await adminJson(`/admin/products/${productId}/inventory`, {
        method: "POST",
        body: JSON.stringify({ delta: Number(delta), changeType }),
      });
      setDelta("");
      await onChanged();
    });
  }

  return (
    <div>
      <h2>Stock: {currentStock}</h2>
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, alignItems: "end" }}>
        <label>
          Adjust by (use a negative number to reduce)
          <input type="number" value={delta} onChange={(e) => setDelta(e.target.value)} required className="input" style={{ display: "block" }} />
        </label>
        <label>
          Reason
          <select value={changeType} onChange={(e) => setChangeType(e.target.value as typeof changeType)} className="input" style={{ display: "block" }}>
            <option value="restock">Restock</option>
            <option value="adjustment">Adjustment</option>
            <option value="return">Return</option>
          </select>
        </label>
        <button type="submit" className="btn btn-primary btn-sm">Apply</button>
      </form>
    </div>
  );
}

function VariantsSection({
  product,
  onChanged,
  withError,
}: {
  product: Product;
  onChanged: () => Promise<void>;
  withError: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [sku, setSku] = useState("");
  const [attrKey, setAttrKey] = useState("size");
  const [attrValue, setAttrValue] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("");

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    await withError(async () => {
      await adminJson(`/admin/products/${product.id}/variants`, {
        method: "POST",
        body: JSON.stringify({
          sku,
          attributes: { [attrKey]: attrValue },
          price: price === "" ? undefined : Number(price),
          stock: Number(stock),
        }),
      });
      setSku("");
      setAttrValue("");
      setPrice("");
      setStock("");
      await onChanged();
    });
  }

  async function handleVariantStock(variantId: string, delta: number) {
    await withError(async () => {
      await adminJson(`/admin/products/${product.id}/inventory`, {
        method: "POST",
        body: JSON.stringify({ variantId, delta, changeType: "adjustment" }),
      });
      await onChanged();
    });
  }

  async function handleDelete(variantId: string) {
    if (!confirm("Delete this variant?")) return;
    await withError(async () => {
      await adminJson(`/admin/products/${product.id}/variants/${variantId}`, { method: "DELETE" });
      await onChanged();
    });
  }

  return (
    <div>
      <h2>Variants</h2>
      <table style={{ borderCollapse: "collapse", width: "100%", marginBottom: 16 }}>
        <thead>
          <tr>
            <th style={cellStyle}>SKU</th>
            <th style={cellStyle}>Attributes</th>
            <th style={cellStyle}>Price</th>
            <th style={cellStyle}>Stock</th>
            <th style={cellStyle}></th>
          </tr>
        </thead>
        <tbody>
          {product.variants.map((v) => (
            <tr key={v.id}>
              <td style={cellStyle}>{v.sku}</td>
              <td style={cellStyle}>{Object.entries(v.attributes).map(([k, val]) => `${k}: ${val}`).join(", ")}</td>
              <td style={cellStyle}>{v.price ? `£${v.price}` : "(base price)"}</td>
              <td style={cellStyle}>
                {v.stock}{" "}
                <button onClick={() => handleVariantStock(v.id, 1)} title="Add 1" className="btn btn-outline btn-sm" style={{ padding: "4px 10px" }}>
                  +1
                </button>{" "}
                <button onClick={() => handleVariantStock(v.id, -1)} title="Remove 1" className="btn btn-outline btn-sm" style={{ padding: "4px 10px" }}>
                  -1
                </button>
              </td>
              <td style={cellStyle}>
                <button onClick={() => handleDelete(v.id)} className="btn btn-outline btn-sm" style={{ color: "var(--danger-text)" }}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form onSubmit={handleAdd} style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
        <label>
          SKU
          <input value={sku} onChange={(e) => setSku(e.target.value)} required className="input" style={{ display: "block" }} />
        </label>
        <label>
          Attribute name
          <input value={attrKey} onChange={(e) => setAttrKey(e.target.value)} className="input" style={{ display: "block" }} />
        </label>
        <label>
          Attribute value
          <input value={attrValue} onChange={(e) => setAttrValue(e.target.value)} required className="input" style={{ display: "block" }} />
        </label>
        <label>
          Price override (optional)
          <input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className="input" style={{ display: "block" }} />
        </label>
        <label>
          Stock
          <input type="number" min="0" value={stock} onChange={(e) => setStock(e.target.value)} required className="input" style={{ display: "block" }} />
        </label>
        <button type="submit" className="btn btn-primary btn-sm">Add variant</button>
      </form>
    </div>
  );
}

function ImagesSection({
  product,
  onChanged,
  withError,
}: {
  product: Product;
  onChanged: () => Promise<void>;
  withError: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [uploading, setUploading] = useState(false);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    await withError(async () => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await adminFetch(`/admin/products/${product.id}/images`, { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Upload failed (${res.status})`);
      }
      await onChanged();
    });
    setUploading(false);
    e.target.value = "";
  }

  async function handleDelete(imageId: string) {
    if (!confirm("Delete this image?")) return;
    await withError(async () => {
      await adminJson(`/admin/products/${product.id}/images/${imageId}`, { method: "DELETE" });
      await onChanged();
    });
  }

  return (
    <div>
      <h2>Images</h2>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        {product.images.map((img) => (
          // eslint-disable-next-line @next/next/no-img-element
          <div key={img.id} style={{ position: "relative" }}>
            <img src={img.url} alt="" width={120} height={120} style={{ objectFit: "cover", borderRadius: 4 }} />
            <button onClick={() => handleDelete(img.id)} className="btn btn-outline btn-sm" style={{ display: "block", marginTop: 4, width: "100%", color: "var(--danger-text)" }}>
              Delete
            </button>
          </div>
        ))}
      </div>
      <input type="file" accept="image/*" onChange={handleUpload} disabled={uploading} />
      {uploading && <p>Uploading…</p>}
      <p style={{ fontSize: 13, color: "var(--ink-muted)" }}>
        Requires <code>CLOUDINARY_*</code> env vars to be set on the backend — uploads will fail with a clear error
        otherwise.
      </p>
    </div>
  );
}

const cellStyle: React.CSSProperties = { border: "1px solid var(--line)", padding: 8, textAlign: "left" };
