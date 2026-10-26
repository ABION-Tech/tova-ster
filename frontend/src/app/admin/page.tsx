"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { adminJson } from "../../lib/backend";
import { useAdmin } from "../../lib/admin/AdminContext";
import { STATUS, gbp } from "../../lib/admin/status";

interface DashboardData {
  glance: { todaySales: number | null; todayOrders: number; weekSales: number | null; weekOrders: number; toPack: number; newCustomers: number; activeSubscriptions: number };
  series: { day: string; total: number; orders: number }[];
  orderCounts: Record<string, number>;
  lowStock: {
    products: { id: string; name: string; stock: number; threshold: number }[];
    variants: { id: string; productId: string; productName: string; attributes: Record<string, string>; stock: number; threshold: number }[];
  };
  recentOrders: { id: string; orderNumber: string; status: string; total: number | null; placedAt: string; customerEmail: string | null }[];
}

const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric" });

export default function AdminDashboard() {
  const { admin } = useAdmin();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminJson<DashboardData>("/admin/dashboard").then(setData).catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="note">Couldn&apos;t load the dashboard: {error}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  const g = data.glance;
  const low = [
    ...data.lowStock.products.map((p) => ({ key: p.id, name: p.name, stock: p.stock, threshold: p.threshold, href: `/admin/products/${p.id}` })),
    ...data.lowStock.variants.map((v) => ({ key: v.id, name: `${v.productName} (${Object.values(v.attributes).join(" / ")})`, stock: v.stock, threshold: v.threshold, href: `/admin/products/${v.productId}` })),
  ];
  const money = g.todaySales !== null;
  const max = Math.max(1, ...data.series.map((d) => d.total));
  const hello = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 18 ? "Good afternoon" : "Good evening";

  return (
    <>
      <div className="ahead">
        <div>
          <h1>{hello}, {admin?.name.split(" ")[0]}</h1>
          <p>{g.toPack ? `${g.toPack} order${g.toPack === 1 ? "" : "s"} to pack.` : "Nothing waiting to be packed."} {low.length ? `${low.length} product${low.length === 1 ? " is" : "s are"} low on stock.` : ""}</p>
        </div>
        <Link href="/admin/orders" className="btn sm">Open orders</Link>
      </div>

      <div className="kpis">
        {money && <div className="kpi"><span>Sales today</span><b>{gbp(g.todaySales!)}</b><em className="muted">{g.todayOrders} order{g.todayOrders === 1 ? "" : "s"}</em></div>}
        {money && <div className="kpi"><span>Last 7 days</span><b>{gbp(g.weekSales!)}</b><em className="muted">{g.weekOrders} orders</em></div>}
        <div className="kpi"><span>To pack</span><b>{g.toPack}</b><em className={g.toPack ? "down" : "up"}>{g.toPack ? "Waiting" : "All clear"}</em></div>
        <div className="kpi"><span>Low stock</span><b>{low.length}</b><em className={low.length ? "down" : "up"}>{low.length ? "Needs reordering" : "All above alert level"}</em></div>
        {money && <div className="kpi"><span>New customers</span><b>{g.newCustomers}</b><em className="muted">last 7 days</em></div>}
        {money && <div className="kpi"><span>Subscriptions</span><b>{g.activeSubscriptions}</b><em className="muted">active</em></div>}
      </div>

      <div className="acols">
        {money ? (
          <div className="acard">
            <div><h2>Sales, last 14 days</h2><p className="sub">Paid orders, UK dates</p></div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${data.series.length}, 1fr)`, gap: 6, height: 180 }} role="img"
              aria-label={`Sales per day: ${data.series.map((d) => `${dayLabel(d.day)} ${gbp(d.total)}`).join(", ")}`}>
              {data.series.map((d) => (
                <div key={d.day} title={`${dayLabel(d.day)}: ${gbp(d.total)}, ${d.orders} orders`} style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }}>
                  <div style={{ height: `${Math.max(2, (d.total / max) * 100)}%`, background: d.total ? "var(--gold)" : "var(--surface-2)", borderRadius: "6px 6px 2px 2px" }} />
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${data.series.length}, 1fr)`, gap: 6, fontSize: 11, color: "var(--ink-3)", textAlign: "center" }}>
              {data.series.map((d, i) => <span key={d.day}>{i % 2 === data.series.length % 2 ? dayLabel(d.day).split(" ")[1] : ""}</span>)}
            </div>
          </div>
        ) : (
          <div className="acard"><h2>Your work</h2><p className="sub">Open Orders to pack and dispatch. Stock levels are on each product.</p></div>
        )}

        <div className="acard">
          <div><h2>Low stock</h2><p className="sub">At or below the alert level</p></div>
          {low.length === 0 ? <p className="muted">All products are above their alert level.</p> : (
            <div className="tbl-wrap"><table className="t"><tbody>
              {low.map((l) => (
                <tr key={l.key}><td><Link href={l.href}>{l.name}</Link></td><td className="r"><span className="pill low">{l.stock} left</span></td></tr>
              ))}
            </tbody></table></div>
          )}
        </div>
      </div>

      <div className="acard">
        <div className="ahead"><div><h2>Recent orders</h2></div><Link href="/admin/orders" className="btn sm ghost">All orders</Link></div>
        <div className="tbl-wrap">
          <table className="t">
            <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Placed</th>{money && <th className="r">Total</th>}</tr></thead>
            <tbody>
              {data.recentOrders.map((o) => (
                <tr key={o.id}>
                  <td><Link href={`/admin/orders/${o.id}`}><b>{o.orderNumber}</b></Link></td>
                  <td>{o.customerEmail ?? "Guest"}</td>
                  <td><span className={`pill ${STATUS[o.status]?.[1] ?? ""}`}>{STATUS[o.status]?.[0] ?? o.status}</span></td>
                  <td>{o.placedAt ? new Date(o.placedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</td>
                  {money && <td className="r">{o.total !== null ? gbp(o.total) : ""}</td>}
                </tr>
              ))}
              {data.recentOrders.length === 0 && <tr><td colSpan={5} className="muted">No orders yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
