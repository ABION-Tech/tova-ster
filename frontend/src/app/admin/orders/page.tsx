"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { adminJson } from "../../../lib/backend";
import { STATUS } from "../../../lib/admin/status";

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
    <>
      <div className="ahead">
        <div><h1>Orders</h1><p>{total} order{total === 1 ? "" : "s"}{status ? `: ${STATUS[status]?.[0] ?? status}` : ""}</p></div>
        <input type="search" placeholder="Order number or email" value={search} onChange={(e) => handleSearchChange(e.target.value)}
          className="ain wide" style={{ maxWidth: 280 }} aria-label="Search orders" />
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} role="tablist" aria-label="Filter by status">
        {["", ...ALL_STATUSES].map((s) => (
          <button key={s || "all"} role="tab" aria-selected={status === s} className={`btn sm${status === s ? "" : " ghost"}`} onClick={() => setStatus(s)}>
            {s ? STATUS[s]?.[0] ?? s : "All"}
          </button>
        ))}
      </div>

      {error && <p className="note">Couldn&apos;t load orders: {error}</p>}

      <div className="acard">
        <div className="tbl-wrap">
          <table className="t">
            <thead><tr><th>Order</th><th>Placed</th><th>Customer</th><th>Status</th><th className="r">Total</th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="muted">Loading…</td></tr>
              ) : orders.length === 0 ? (
                <tr><td colSpan={5} className="muted">No orders found.</td></tr>
              ) : orders.map((o) => (
                <tr key={o.id} className="click" onClick={() => router.push(`/admin/orders/${o.id}`)}>
                  <td><Link href={`/admin/orders/${o.id}`} onClick={(e) => e.stopPropagation()}><b>{o.orderNumber}</b></Link></td>
                  <td>{new Date(o.placedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                  <td>{o.customerName || o.customerEmail || "Guest"}{o.isGuest && <span className="muted"> (guest)</span>}</td>
                  <td><span className={`pill ${STATUS[o.status]?.[1] ?? ""}`}>{STATUS[o.status]?.[0] ?? o.status}</span></td>
                  <td className="r">{fmt(o.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {total > LIMIT && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
            <button className="btn sm ghost" disabled={offset === 0} onClick={() => { const o = Math.max(0, offset - LIMIT); setOffset(o); load(status, search, o); }}>Previous</button>
            <span>{offset + 1}–{Math.min(offset + LIMIT, total)} of {total}</span>
            <button className="btn sm ghost" disabled={offset + LIMIT >= total} onClick={() => { const o = offset + LIMIT; setOffset(o); load(status, search, o); }}>Next</button>
          </div>
        )}
      </div>
    </>
  );
}

