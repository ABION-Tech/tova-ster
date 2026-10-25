"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { adminJson } from "../../lib/backend";

interface DashboardData {
  revenue: { total: number; orderCount: number };
  orderCounts: Record<string, number>;
  lowStock: {
    products: { id: string; name: string; slug: string; status: string; stock: number; threshold: number }[];
    variants: { id: string; productId: string; productName: string; attributes: Record<string, string>; stock: number; threshold: number; status: string }[];
  };
  recentOrders: { id: string; orderNumber: string; status: string; total: number; placedAt: string; customerEmail: string | null }[];
}

const STATUS_LABELS: Record<string, string> = {
  PENDING_PAYMENT: "Pending payment",
  PAID: "Paid",
  PROCESSING: "Processing",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

const STATUS_COLORS: Record<string, string> = {
  PENDING_PAYMENT: "#8A5A17",
  PAID: "var(--success-text)",
  PROCESSING: "var(--gold-deep)",
  SHIPPED: "var(--moss)",
  DELIVERED: "var(--success-text)",
  CANCELLED: "var(--danger-text)",
  REFUNDED: "var(--ink-muted)",
};

function fmt(n: number) {
  return `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminJson<DashboardData>("/admin/dashboard")
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p style={{ color: "var(--danger-text)" }}>Error: {error}</p>;
  if (!data) return <p>Loading…</p>;

  const lowStockCount = data.lowStock.products.length + data.lowStock.variants.length;

  return (
    <main>
      <h1 style={{ marginBottom: 24 }}>Dashboard</h1>

      {/* ── Stat cards ──────────────────────────────────────────────────── */}
      <div className="grid-4" style={{ marginBottom: 32 }}>
        <StatCard label="Revenue (fulfilled)" value={fmt(data.revenue.total)} sub={`${data.revenue.orderCount} orders`} />
        <StatCard label="Pending payment" value={String(data.orderCounts["PENDING_PAYMENT"] ?? 0)} />
        <StatCard label="Processing / Shipped" value={String((data.orderCounts["PROCESSING"] ?? 0) + (data.orderCounts["SHIPPED"] ?? 0))} />
        <StatCard label="Low-stock alerts" value={String(lowStockCount)} alert={lowStockCount > 0} />
      </div>

      <div className="two-col">
        {/* ── Recent orders ──────────────────────────────────────────────── */}
        <section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h2 style={{ fontSize: 15 }}>Recent orders</h2>
            <Link href="/admin/orders" style={{ fontSize: 13, color: "var(--gold-deep)" }}>View all →</Link>
          </div>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={th}>Order</th>
                <th style={th}>Customer</th>
                <th style={th}>Status</th>
                <th style={th}>Total</th>
              </tr>
            </thead>
            <tbody>
              {data.recentOrders.map((o) => (
                <tr key={o.id}>
                  <td style={td}>
                    <Link href={`/admin/orders/${o.id}`} style={{ color: "var(--gold-deep)" }}>{o.orderNumber}</Link>
                  </td>
                  <td style={td}>{o.customerEmail ?? "—"}</td>
                  <td style={td}>
                    <span style={{ color: STATUS_COLORS[o.status] ?? "var(--ink-muted)", fontWeight: 600 }}>
                      {STATUS_LABELS[o.status] ?? o.status}
                    </span>
                  </td>
                  <td style={td}>{fmt(o.total)}</td>
                </tr>
              ))}
              {data.recentOrders.length === 0 && (
                <tr><td style={td} colSpan={4}>No orders yet.</td></tr>
              )}
            </tbody>
          </table>
        </section>

        {/* ── Low-stock alerts ──────────────────────────────────────────── */}
        <section>
          <h2 style={{ fontSize: 15, marginBottom: 12 }}>
            Low-stock alerts {lowStockCount > 0 && <span style={{ color: "var(--danger-text)" }}>({lowStockCount})</span>}
          </h2>
          {lowStockCount === 0 ? (
            <p style={{ color: "var(--ink-muted)", fontSize: 13 }}>All products are above their thresholds.</p>
          ) : (
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={th}>Product</th>
                  <th style={th}>Stock</th>
                  <th style={th}>Threshold</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {data.lowStock.products.map((p) => (
                  <tr key={p.id}>
                    <td style={td}>{p.name}</td>
                    <td style={{ ...td, color: p.stock === 0 ? "var(--danger-text)" : "#8A5A17", fontWeight: 600 }}>{p.stock}</td>
                    <td style={td}>{p.threshold}</td>
                    <td style={td}><Link href={`/admin/products/${p.id}`} style={{ color: "var(--gold-deep)" }}>Edit</Link></td>
                  </tr>
                ))}
                {data.lowStock.variants.map((v) => (
                  <tr key={v.id}>
                    <td style={td}>
                      {v.productName}
                      <span style={{ color: "var(--ink-muted)" }}> — {Object.values(v.attributes).join(" / ")}</span>
                    </td>
                    <td style={{ ...td, color: v.stock === 0 ? "var(--danger-text)" : "#8A5A17", fontWeight: 600 }}>{v.stock}</td>
                    <td style={td}>{v.threshold}</td>
                    <td style={td}><Link href={`/admin/products/${v.productId}`} style={{ color: "var(--gold-deep)" }}>Edit</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {/* ── Order counts by status ─────────────────────────────────────── */}
      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 15, marginBottom: 12 }}>Orders by status</h2>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {Object.entries(STATUS_LABELS).map(([status, label]) => {
            const count = data.orderCounts[status] ?? 0;
            return (
              <Link
                key={status}
                href={`/admin/orders?status=${status}`}
                style={{ textDecoration: "none" }}
              >
                <div style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "8px 14px", textAlign: "center", minWidth: 90 }}>
                  <div style={{ fontWeight: 700, fontSize: 20 }}>{count}</div>
                  <div style={{ fontSize: 12, color: STATUS_COLORS[status] ?? "var(--ink-muted)" }}>{label}</div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function StatCard({ label, value, sub, alert }: { label: string; value: string; sub?: string; alert?: boolean }) {
  return (
    <div style={{ border: `1px solid ${alert ? "#E3B4A4" : "var(--line)"}`, borderRadius: 8, padding: 16, background: alert ? "var(--danger-bg)" : "var(--surface)" }}>
      <div style={{ fontSize: 12, color: "var(--ink-muted)", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: alert ? "var(--danger-text)" : "var(--ink)" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

const th: React.CSSProperties = { border: "1px solid var(--line)", padding: "6px 8px", textAlign: "left", background: "var(--surface-2)" };
const td: React.CSSProperties = { border: "1px solid var(--line)", padding: "6px 8px" };
