"use client";

import { useCallback, useEffect, useState } from "react";
import { adminJson } from "../../../lib/backend";
import { canEdit, useAdmin } from "../../../lib/admin/AdminContext";

interface Bundle { id: string; name: string; blurb: string | null; product_ids: string[]; pct: number; active: boolean; sort_order: number; orders: number }
interface Code { code: string; pct: number; active: boolean; uses: number; max_uses: number | null; note: string | null; expires_at: string | null; first_order_only: boolean }
interface Product { id: string; name: string; status: string }

const blankBundle = { name: "", blurb: "", productIds: [] as string[], discountPct: 15 };
const blankCode = { code: "", pct: 10, note: "", maxUses: "", expiresAt: "", firstOrderOnly: false };

export default function OffersAdmin() {
  const { admin } = useAdmin();
  const may = canEdit(admin?.role, "products");
  const [data, setData] = useState<{ bundles: Bundle[]; codes: Code[] } | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [nb, setNb] = useState(blankBundle);
  const [nc, setNc] = useState(blankCode);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { adminJson<{ bundles: Bundle[]; codes: Code[] }>("/admin/offers").then(setData).catch((e: Error) => setMsg(e.message)); }, []);
  useEffect(() => {
    load();
    adminJson<{ products: Product[] }>("/admin/products").then((d) => setProducts(d.products.filter((p) => p.status !== "archived"))).catch(() => {});
  }, [load]);
  const name = (id: string) => products.find((p) => p.id === id)?.name ?? "Removed product";

  async function act(fn: () => Promise<unknown>, done: string) {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg(done); load(); } catch (e) { setMsg(e instanceof Error ? e.message : "Something went wrong."); } finally { setBusy(false); }
  }

  if (!data) return <p className="muted">{msg ?? "Loading…"}</p>;
  return (
    <>
      <div className="ahead"><div><h1>Bundles & codes</h1><p>Bundles take a percentage off a set of products bought together. Codes are typed at checkout.</p></div></div>
      {!may && <p className="note">View only for your role ({admin?.role}).</p>}
      {msg && <p className="note" role="status">{msg}</p>}

      <div className="acard">
        <h2>Bundles</h2>
        <div className="tbl-wrap"><table className="t">
          <thead><tr><th>Bundle</th><th>Products</th><th className="r">Off</th><th className="r">Orders</th><th>Showing</th>{may && <th />}</tr></thead>
          <tbody>
            {data.bundles.length === 0 && <tr><td colSpan={6} className="muted">No bundles yet.</td></tr>}
            {data.bundles.map((b) => (
              <tr key={b.id}>
                <td><b>{b.name}</b>{b.blurb && <><br /><span className="muted">{b.blurb}</span></>}</td>
                <td>{b.product_ids.map(name).join(" + ")}</td>
                <td className="r">{b.pct}%</td>
                <td className="r">{b.orders}</td>
                <td>
                  <label className="switch" aria-label={`Show ${b.name}`}>
                    <input type="checkbox" checked={b.active} disabled={!may || busy}
                      onChange={(e) => act(() => adminJson(`/admin/bundles/${b.id}`, { method: "PATCH", body: JSON.stringify({ active: e.target.checked }) }), `${b.name} ${e.target.checked ? "is showing" : "is hidden"}.`)} />
                    <span />
                  </label>
                </td>
                {may && <td className="r"><button className="btn sm ghost" disabled={busy} onClick={() => confirm(`Delete the bundle "${b.name}"?`) && act(() => adminJson(`/admin/bundles/${b.id}`, { method: "DELETE" }), "Bundle deleted.")}>Delete</button></td>}
              </tr>
            ))}
          </tbody>
        </table></div>
        {may && (
          <form style={{ display: "grid", gap: 10, borderTop: "1px solid var(--line)", paddingTop: 14 }} onSubmit={(e) => { e.preventDefault(); act(async () => {
            await adminJson("/admin/bundles", { method: "POST", body: JSON.stringify({ ...nb, blurb: nb.blurb || undefined, active: true }) }); setNb(blankBundle);
          }, "Bundle added and showing."); }}>
            <b>New bundle</b>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
              <input className="ain wide" placeholder="Name, e.g. Winter essentials" required maxLength={80} value={nb.name} onChange={(e) => setNb({ ...nb, name: e.target.value })} aria-label="Bundle name" />
              <input className="ain wide" placeholder="One line about it" maxLength={300} value={nb.blurb} onChange={(e) => setNb({ ...nb, blurb: e.target.value })} aria-label="Bundle description" />
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
                <input className="ain" type="number" min={1} max={90} required value={nb.discountPct} onChange={(e) => setNb({ ...nb, discountPct: Number(e.target.value) })} aria-label="Percent off" />% off
              </label>
            </div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 14 }}>
              {products.map((p) => (
                <label key={p.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="checkbox" checked={nb.productIds.includes(p.id)}
                    onChange={(e) => setNb({ ...nb, productIds: e.target.checked ? [...nb.productIds, p.id] : nb.productIds.filter((x) => x !== p.id) })} />{p.name}
                </label>
              ))}
            </div>
            <div><button className="btn sm" disabled={busy || nb.productIds.length < 2}>Add bundle</button> <span className="muted">Pick 2 to 6 products.</span></div>
          </form>
        )}
      </div>

      <div className="acard">
        <h2>Discount codes</h2>
        <div className="tbl-wrap"><table className="t">
          <thead><tr><th>Code</th><th className="r">Off</th><th>Rules</th><th className="r">Used</th><th>On</th>{may && <th />}</tr></thead>
          <tbody>
            {data.codes.length === 0 && <tr><td colSpan={6} className="muted">No codes yet.</td></tr>}
            {data.codes.map((c) => (
              <tr key={c.code}>
                <td><b>{c.code}</b>{c.note && <><br /><span className="muted">{c.note}</span></>}</td>
                <td className="r">{c.pct}%</td>
                <td>{[c.first_order_only && "First order only", c.max_uses && `Up to ${c.max_uses} uses`, c.expires_at && `Ends ${new Date(c.expires_at).toLocaleDateString("en-GB")}`].filter(Boolean).join(" · ") || "Any order"}</td>
                <td className="r">{c.uses}</td>
                <td>
                  <label className="switch" aria-label={`Code ${c.code} on`}>
                    <input type="checkbox" checked={c.active} disabled={!may || busy}
                      onChange={(e) => act(() => adminJson(`/admin/codes/${c.code}`, { method: "PATCH", body: JSON.stringify({ active: e.target.checked }) }), `${c.code} ${e.target.checked ? "switched on" : "switched off"}.`)} />
                    <span />
                  </label>
                </td>
                {may && <td className="r"><button className="btn sm ghost" disabled={busy} onClick={() => confirm(`Delete code ${c.code}?`) && act(() => adminJson(`/admin/codes/${c.code}`, { method: "DELETE" }), "Code deleted.")}>Delete</button></td>}
              </tr>
            ))}
          </tbody>
        </table></div>
        {may && (
          <form style={{ display: "grid", gap: 10, borderTop: "1px solid var(--line)", paddingTop: 14 }} onSubmit={(e) => { e.preventDefault(); act(async () => {
            await adminJson("/admin/codes", { method: "POST", body: JSON.stringify({
              code: nc.code, pct: nc.pct, note: nc.note || undefined, firstOrderOnly: nc.firstOrderOnly,
              maxUses: nc.maxUses ? Number(nc.maxUses) : null, expiresAt: nc.expiresAt ? new Date(`${nc.expiresAt}T23:59:59`).toISOString() : null,
            }) });
            setNc(blankCode);
          }, "Code added."); }}>
            <b>New code</b>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, alignItems: "center" }}>
              <input className="ain wide" placeholder="CODE" required pattern="[A-Za-z0-9_-]{3,30}" value={nc.code} onChange={(e) => setNc({ ...nc, code: e.target.value.toUpperCase() })} aria-label="Code" />
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}><input className="ain" type="number" min={1} max={90} required value={nc.pct} onChange={(e) => setNc({ ...nc, pct: Number(e.target.value) })} aria-label="Percent off" />% off</label>
              <input className="ain wide" type="number" min={1} placeholder="Max uses (optional)" value={nc.maxUses} onChange={(e) => setNc({ ...nc, maxUses: e.target.value })} aria-label="Maximum uses" />
              <label style={{ display: "grid", gap: 2, fontSize: 12 }}>Ends (optional)<input className="ain wide" type="date" value={nc.expiresAt} onChange={(e) => setNc({ ...nc, expiresAt: e.target.value })} /></label>
              <input className="ain wide" placeholder="Note for the team" maxLength={200} value={nc.note} onChange={(e) => setNc({ ...nc, note: e.target.value })} aria-label="Note" />
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 14 }}><input type="checkbox" checked={nc.firstOrderOnly} onChange={(e) => setNc({ ...nc, firstOrderOnly: e.target.checked })} />First order only</label>
            </div>
            <div><button className="btn sm" disabled={busy}>Add code</button></div>
          </form>
        )}
      </div>
    </>
  );
}
