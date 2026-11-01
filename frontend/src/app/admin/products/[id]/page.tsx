"use client";

import Link from "next/link";
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
  alt_text?: string | null;
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

  if (!product) return <p className="muted">Loading product…</p>;

  async function withError(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <>
      <div className="ahead">
        <div>
          <Link className="backlink" href="/admin/products">← All products</Link>
          <h1>{product.name}</h1>
        </div>
        <a className="btn ghost sm" href={`/products/${product.slug}`} target="_blank" rel="noopener">View in the shop</a>
      </div>
      {error && <div className="notice warn" role="alert">{error}</div>}
      {!mayEdit && (
        <div className="notice gold">View only for your role ({admin?.role}).{mayStock ? " You can update stock." : ""}</div>
      )}

      <div className="pgrid">
      <fieldset disabled={!mayEdit} className="acard plain">
        <EditProductForm product={product} onSaved={load} withError={withError} />
      </fieldset>

      <div className="pcol">
      {product.has_variants ? (
        <fieldset disabled={!mayEdit} className="acard plain">
          <VariantsSection product={product} onChanged={load} withError={withError} />
        </fieldset>
      ) : (
        <fieldset disabled={!mayStock} className="acard plain">
          <StockAdjustSection productId={product.id} currentStock={product.stock} onChanged={load} withError={withError} />
        </fieldset>
      )}

      <fieldset disabled={!mayEdit} className="acard plain">
        <ImagesSection product={product} onChanged={load} withError={withError} />
      </fieldset>
      </div>
      </div>
    </>
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
    <form onSubmit={handleSubmit} className="stack">
      <h2>Details</h2>
      <label className="fld">Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <div className="formgrid">
        <label className="fld">Price (£, including VAT)<input type="number" min="0" step="0.01" inputMode="decimal" value={basePrice} onChange={(e) => setBasePrice(e.target.value)} /></label>
        <label className="fld">Sale price (£, optional)<input type="number" min="0" step="0.01" inputMode="decimal" value={discountPrice} onChange={(e) => setDiscountPrice(e.target.value)} /></label>
      </div>
      <label className="fld">Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={6} /></label>
      <label className="fld">Status
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="draft">Draft (hidden from the shop)</option>
          <option value="active">On sale</option>
          <option value="out_of_stock">Sold out</option>
          <option value="archived">Archived</option>
        </select>
      </label>
      <div><button type="submit" className="btn sm">Save details</button></div>
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
    <div className="stack">
      <div className="frow"><h2>Stock</h2><b className="bignum">{currentStock ?? "–"}</b></div>
      <form onSubmit={handleSubmit} className="formgrid">
        <label className="fld">
          Add or remove (e.g. 24 or -2)
          <input type="number" inputMode="numeric" value={delta} onChange={(e) => setDelta(e.target.value)} required />
        </label>
        <label className="fld">
          Reason
          <select value={changeType} onChange={(e) => setChangeType(e.target.value as typeof changeType)}>
            <option value="restock">Restock</option>
            <option value="adjustment">Adjustment</option>
            <option value="return">Return</option>
          </select>
        </label>
        <div className="fld" style={{ alignContent: "end" }}><button type="submit" className="btn sm">Update stock</button></div>
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

  async function makeMain(imageId: string) {
    await withError(async () => {
      await adminJson(`/admin/products/${product.id}/images/${imageId}`, { method: "PATCH", body: JSON.stringify({ isPrimary: true }) });
      await onChanged();
    });
  }

  async function handleDelete(imageId: string) {
    if (!confirm("Delete this image?")) return;
    await withError(async () => {
      await adminJson(`/admin/products/${product.id}/images/${imageId}`, { method: "DELETE" });
      await onChanged();
    });
  }

  return (
    <div className="stack">
      <h2>Photos</h2>
      <div className="photogrid">
        {product.images.map((img) => (
          <div key={img.id} className="photo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.url} alt={img.alt_text ?? ""} className={img.is_primary ? "main" : ""} />
            {img.is_primary
              ? <span className="pill active" style={{ justifySelf: "start" }}>Main photo</span>
              : <button onClick={() => makeMain(img.id)} className="btn ghost sm">Make main</button>}
            <button onClick={() => handleDelete(img.id)} className="btn ghost sm danger">Delete</button>
          </div>
        ))}
      </div>
      <label className="btn sm" style={{ cursor: uploading ? "wait" : "pointer", justifySelf: "start" }}>
        {uploading ? "Uploading…" : "Add a photo"}
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleUpload} disabled={uploading} style={{ display: "none" }} />
      </label>
      <p className="muted">
        JPG, PNG or WebP, up to 5 MB. Only use the client&apos;s own product photos. Square photos on a plain background look best.
      </p>
    </div>
  );
}

const cellStyle: React.CSSProperties = { border: "1px solid var(--line)", padding: 8, textAlign: "left" };
