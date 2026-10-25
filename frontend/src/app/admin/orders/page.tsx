"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { adminJson } from "../../../lib/backend";

interface AdminOrder {
  id: string;
  orderNumber: string;
  status: string;
  total: number;
  currency: string;
  placedAt: string;
  customerEmail: string | null;
  customerName: string | null;
  isGuest: boolean;
}

const ALL_STATUSES = [
  "PENDING_PAYMENT", "PAID", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED",
];

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

export default function AdminOrdersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initStatus = searchParams.get("status") ?? "";
  const initSearch = searchParams.get("search") ?? "";

  const [status, setStatus] = useState(initStatus);
  const [search, setSearch] = useState(initSearch);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    (s: string, q: string, off: number) => {
      setLoading(true);
      setError(null);
      const qs = new URLSearchParams();
      if (s) qs.set("status", s);
      if (q) qs.set("search", q);
      qs.set("limit", String(LIMIT));
      qs.set("offset", String(off));
      adminJson<{ orders: AdminOrder[]; total: number }>(`/admin/orders?${qs}`)
        .then((data) => { setOrders(data.orders); setTotal(data.total); })
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false));
    },
    [],
  );

  // Sync URL and reload when filters change
  useEffect(() => {
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (search) qs.set("search", search);
    router.replace(`/admin/orders${qs.toString() ? `?${qs}` : ""}`, { scroll: false });
    setOffset(0);
    load(status, search, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  function handleSearchChange(val: string) {
    setSearch(val);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setOffset(0);
      load(status, val, 0);
    }, 350);
  }

  return (
    <main>
      <h1 className="display-3" style={{ marginBottom: 20 }}>Orders</h1>

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, alignItems: "center", flexWrap: "wrap" }}>
        {/* Status tab strip */}
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          <button
            style={tabStyle(status === "")}
            onClick={() => setStatus("")}
          >
            All
          </button>
          {ALL_STATUSES.map((s) => (
            <button key={s} style={tabStyle(status === s)} onClick={() => setStatus(s)}>
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="Order # or email…"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          style={{ padding: "6px 10px", border: "1px solid var(--line)", borderRadius: 4, fontSize: 13, width: 200 }}
        />
      </div>

      {error && <p style={{ color: "var(--danger-text)", marginBottom: 12 }}>Error: {error}</p>}

      {/* ── Table ───────────────────────────────────────────────────────── */}
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
        <thead>
          <tr>
            <th style={th}>Order #</th>
            <th style={th}>Placed</th>
            <th style={th}>Customer</th>
            <th style={th}>Status</th>
            <th style={th}>Total</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td style={td} colSpan={6}>Loading…</td></tr>
          ) : orders.length === 0 ? (
            <tr><td style={td} colSpan={6}>No orders found.</td></tr>
          ) : (
            orders.map((o) => (
              <tr key={o.id}>
                <td style={td}>
                  <Link href={`/admin/orders/${o.id}`} style={{ color: "var(--gold-deep)", fontWeight: 600 }}>
                    {o.orderNumber}
                  </Link>
                </td>
                <td style={td}>{new Date(o.placedAt).toLocaleDateString("en-NG")}</td>
                <td style={td}>
                  {o.customerEmail ?? "—"}
                  {o.isGuest && <span style={{ fontSize: 11, color: "var(--ink-muted)", marginLeft: 4 }}>(guest)</span>}
                </td>
                <td style={td}>
                  <span style={{ color: STATUS_COLORS[o.status] ?? "var(--ink-muted)", fontWeight: 600 }}>
                    {STATUS_LABELS[o.status] ?? o.status}
                  </span>
                </td>
                <td style={td}>{fmt(o.total)}</td>
                <td style={td}>
                  <Link href={`/admin/orders/${o.id}`} style={{ color: "var(--gold-deep)" }}>View</Link>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* ── Pagination ──────────────────────────────────────────────────── */}
      {total > LIMIT && (
        <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
          <button
            disabled={offset === 0}
            onClick={() => { const o = Math.max(0, offset - LIMIT); setOffset(o); load(status, search, o); }}
            style={{ padding: "4px 10px", cursor: offset === 0 ? "default" : "pointer" }}
          >
            ← Prev
          </button>
          <span>{offset + 1}–{Math.min(offset + LIMIT, total)} of {total}</span>
          <button
            disabled={offset + LIMIT >= total}
            onClick={() => { const o = offset + LIMIT; setOffset(o); load(status, search, o); }}
            style={{ padding: "4px 10px", cursor: offset + LIMIT >= total ? "default" : "pointer" }}
          >
            Next →
          </button>
        </div>
      )}
    </main>
  );
}

const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: "4px 10px",
  border: `1px solid ${active ? "var(--gold-deep)" : "var(--line)"}`,
  borderRadius: 4,
  background: active ? "var(--gold-deep)" : "var(--surface)",
  color: active ? "var(--surface)" : "var(--ink-muted)",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: active ? 600 : 400,
});

const th: React.CSSProperties = { border: "1px solid var(--line)", padding: "6px 8px", textAlign: "left", background: "var(--surface-2)" };
const td: React.CSSProperties = { border: "1px solid var(--line)", padding: "6px 8px" };
