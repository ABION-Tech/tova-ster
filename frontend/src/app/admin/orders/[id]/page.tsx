"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { adminJson } from "../../../../lib/backend";

interface AdminOrderDetail {
  id: string;
  orderNumber: string;
  status: string;
  currency: string;
  subtotal: number;
  deliveryFee: number;
  discountTotal: number;
  total: number;
  placedAt: string;
  deliveryInstructions: string | null;
  customer: {
    isGuest: boolean;
    email: string | null;
    phone: string | null;
    name: string | null;
    userId: string | null;
  };
  shippingAddress: {
    fullName: string | null;
    phone: string | null;
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    postalCode: string | null;
  } | null;
  items: {
    id: string;
    productId: string | null;
    productNameSnapshot: string;
    variantAttributesSnapshot: Record<string, string> | null;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  }[];
  payments: {
    id: string;
    provider: string;
    reference: string;
    status: string;
    amount: number;
    createdAt: string;
    verifiedAt: string | null;
  }[];
  allowedNextStatuses: string[];
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

const PAYMENT_STATUS_COLORS: Record<string, string> = {
  initiated: "#8A5A17",
  pending: "#8A5A17",
  success: "var(--success-text)",
  failed: "var(--danger-text)",
  cancelled: "var(--ink-muted)",
};

function fmt(n: number) {
  return `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function AdminOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<AdminOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    adminJson<{ order: AdminOrderDetail }>(`/admin/orders/${id}`)
      .then((d) => setOrder(d.order))
      .catch((e: Error) => setError(e.message));
  }, [id]);

  const [tracking, setTracking] = useState({ number: "", carrier: "Royal Mail Tracked 48" });
  async function handleStatusUpdate(newStatus: string) {
    if (!order) return;
    setUpdatingStatus(true);
    setStatusMsg(null);
    try {
      await adminJson(`/admin/orders/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify(newStatus === "SHIPPED" && tracking.number.trim()
          ? { status: newStatus, trackingNumber: tracking.number.trim(), carrier: tracking.carrier.trim() || undefined }
          : { status: newStatus }),
      });
      setOrder({ ...order, status: newStatus, allowedNextStatuses: [] });
      // Re-fetch to get fresh allowedNextStatuses
      const updated = await adminJson<{ order: AdminOrderDetail }>(`/admin/orders/${id}`);
      setOrder(updated.order);
      setStatusMsg(`Status updated to ${STATUS_LABELS[newStatus] ?? newStatus}.`);
    } catch (e: unknown) {
      setStatusMsg(`Error: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setUpdatingStatus(false);
    }
  }

  if (error) return <p style={{ color: "var(--danger-text)" }}>Error: {error}</p>;
  if (!order) return <p>Loading…</p>;

  return (
    <main style={{ maxWidth: 900 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <Link href="/admin/orders" style={{ color: "var(--gold-deep)", fontSize: 13 }}>← Orders</Link>
        <h1 style={{ fontSize: 20 }}>{order.orderNumber}</h1>
        <span style={{ fontSize: 13, background: "var(--surface-2)", padding: "3px 10px", borderRadius: 20 }}>
          {STATUS_LABELS[order.status] ?? order.status}
        </span>
      </div>

      <div className="two-col" style={{ marginBottom: 20 }}>
        {/* ── Customer ─────────────────────────────────────────────────── */}
        <section style={card}>
          <h2 style={cardTitle}>Customer</h2>
          <p style={row}><b>Email</b> {order.customer.email ?? "—"}</p>
          <p style={row}><b>Name</b> {order.customer.name ?? "—"}</p>
          <p style={row}><b>Phone</b> {order.customer.phone ?? "—"}</p>
          <p style={row}><b>Type</b> {order.customer.isGuest ? "Guest" : "Registered"}</p>
        </section>

        {/* ── Shipping address ─────────────────────────────────────────── */}
        <section style={card}>
          <h2 style={cardTitle}>Shipping address</h2>
          {order.shippingAddress ? (
            <>
              <p style={row}>{order.shippingAddress.fullName}</p>
              <p style={row}>{order.shippingAddress.line1}{order.shippingAddress.line2 ? `, ${order.shippingAddress.line2}` : ""}</p>
              <p style={row}>{order.shippingAddress.city}{order.shippingAddress.state ? `, ${order.shippingAddress.state}` : ""} {order.shippingAddress.postalCode ?? ""}</p>
              <p style={row}>{order.shippingAddress.phone}</p>
              {order.deliveryInstructions && (
                <p style={{ ...row, fontStyle: "italic", color: "var(--ink-muted)", marginTop: 8 }}>
                  Note: {order.deliveryInstructions}
                </p>
              )}
            </>
          ) : (
            <p style={{ color: "var(--ink-muted)" }}>—</p>
          )}
        </section>
      </div>

      {/* ── Order items ─────────────────────────────────────────────────── */}
      <section style={{ ...card, marginBottom: 20 }}>
        <h2 style={cardTitle}>Items</h2>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={th}>Product</th>
              <th style={th}>Unit price</th>
              <th style={th}>Qty</th>
              <th style={th}>Line total</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.id}>
                <td style={td}>
                  {item.productNameSnapshot}
                  {item.variantAttributesSnapshot && (
                    <span style={{ color: "var(--ink-muted)" }}> — {Object.values(item.variantAttributesSnapshot).join(" / ")}</span>
                  )}
                </td>
                <td style={td}>{fmt(item.unitPrice)}</td>
                <td style={td}>{item.quantity}</td>
                <td style={td}>{fmt(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ textAlign: "right", marginTop: 12, fontSize: 13 }}>
          <p style={row}>Subtotal: {fmt(order.subtotal)}</p>
          {order.discountTotal > 0 && <p style={row}>Discount: −{fmt(order.discountTotal)}</p>}
          <p style={row}>Delivery: {order.deliveryFee > 0 ? fmt(order.deliveryFee) : "Free"}</p>
          <p style={{ ...row, fontWeight: 700, fontSize: 15 }}>Total: {fmt(order.total)}</p>
        </div>
      </section>

      <div className="two-col">
        {/* ── Payment records ──────────────────────────────────────────── */}
        <section style={card}>
          <h2 style={cardTitle}>Payments</h2>
          {order.payments.length === 0 ? (
            <p style={{ color: "var(--ink-muted)", fontSize: 13 }}>No payment attempts yet.</p>
          ) : (
            order.payments.map((p) => (
              <div key={p.id} style={{ marginBottom: 10, fontSize: 13 }}>
                <p style={row}>
                  <b>{p.provider}</b>{" "}
                  <span style={{ color: PAYMENT_STATUS_COLORS[p.status] ?? "var(--ink-muted)", fontWeight: 600 }}>
                    {p.status}
                  </span>
                </p>
                <p style={{ ...row, color: "var(--ink-muted)" }}>Ref: {p.reference}</p>
                <p style={{ ...row, color: "var(--ink-muted)" }}>Amount: {fmt(p.amount)}</p>
                {p.verifiedAt && (
                  <p style={{ ...row, color: "var(--ink-muted)" }}>
                    Verified: {new Date(p.verifiedAt).toLocaleString("en-GB")}
                  </p>
                )}
              </div>
            ))
          )}
        </section>

        {/* ── Status update ────────────────────────────────────────────── */}
        <section style={card}>
          <h2 style={cardTitle}>Update status</h2>
          <p style={{ fontSize: 13, marginBottom: 10 }}>
            Current: <b>{STATUS_LABELS[order.status] ?? order.status}</b>
          </p>
          {order.allowedNextStatuses.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--ink-muted)" }}>No further transitions available.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {order.allowedNextStatuses.includes("SHIPPED") && (
                <div style={{ display: "grid", gap: 6, padding: 10, background: "var(--surface)", borderRadius: 4 }}>
                  <label style={{ fontSize: 12 }}>Tracking number (sent to the customer)
                    <input value={tracking.number} onChange={(e) => setTracking({ ...tracking, number: e.target.value })} placeholder="e.g. AB123456789GB" maxLength={60} style={{ display: "block", width: "100%", padding: 6, marginTop: 4 }} /></label>
                  <label style={{ fontSize: 12 }}>Carrier
                    <input value={tracking.carrier} onChange={(e) => setTracking({ ...tracking, carrier: e.target.value })} maxLength={60} style={{ display: "block", width: "100%", padding: 6, marginTop: 4 }} /></label>
                </div>
              )}
              {order.allowedNextStatuses.map((s) => (
                <button
                  key={s}
                  disabled={updatingStatus}
                  onClick={() => handleStatusUpdate(s)}
                  style={{ padding: "7px 14px", border: "1px solid var(--line-strong)", borderRadius: 4, cursor: "pointer", fontSize: 13, textAlign: "left", background: "var(--surface)" }}
                >
                  Mark as {STATUS_LABELS[s] ?? s}
                </button>
              ))}
            </div>
          )}
          {statusMsg && (
            <p style={{ marginTop: 10, fontSize: 13, color: statusMsg.startsWith("Error") ? "var(--danger-text)" : "var(--success-text)" }}>
              {statusMsg}
            </p>
          )}
        </section>
      </div>

      <p style={{ marginTop: 16, fontSize: 12, color: "var(--ink-faint)" }}>
        Placed {new Date(order.placedAt).toLocaleString("en-GB")} · Order ID: {order.id}
      </p>
    </main>
  );
}

const card: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 8, padding: 16 };
const cardTitle: React.CSSProperties = { fontSize: 14, fontWeight: 700, marginBottom: 10 };
const row: React.CSSProperties = { margin: "3px 0", fontSize: 13 };
const th: React.CSSProperties = { border: "1px solid var(--line)", padding: "6px 8px", textAlign: "left", background: "var(--surface-2)" };
const td: React.CSSProperties = { border: "1px solid var(--line)", padding: "6px 8px" };
