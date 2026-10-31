"use client";

import { useState } from "react";
import { adminJson } from "../../lib/backend";

export interface RefundRow { id: string; amount: number; status: string; reason: string | null; restocked: boolean; pointsReversed: number; createdAt: string; by: string | null; reference: string | null }

const gbp = (n: number) => `£${n.toFixed(2)}`;

/** Refunds on an order: what has gone back, and (for Managers and the Owner) a whole or part refund through Stripe. */
export function RefundPanel({ orderId, status, total, refundable, refunds, onDone }: {
  orderId: string; status: string; total: number; refundable: number; refunds: RefundRow[]; onDone: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [part, setPart] = useState(false);
  const [amount, setAmount] = useState(refundable.toFixed(2));
  const [restock, setRestock] = useState(["PAID", "PROCESSING"].includes(status));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const value = part ? Math.round(Number(amount) * 100) / 100 : refundable;
  const valid = value > 0 && value <= refundable;

  async function go() {
    if (!valid) return;
    if (!confirm(`Refund ${gbp(value)} to the customer's card? This can't be undone.`)) return;
    setBusy(true); setErr(null);
    try {
      await adminJson(`/admin/orders/${orderId}/refund`, { method: "POST", body: JSON.stringify({ amount: part ? value : undefined, restock: !part && restock, reason: reason.trim() || undefined }) });
      setOpen(false);
      onDone(`Refunded ${gbp(value)}. The customer has been emailed.`);
    } catch (e) { setErr(e instanceof Error ? e.message : "Refund failed."); } finally { setBusy(false); }
  }

  if (!refunds.length && refundable <= 0) return null;
  return (
    <section className="acard">
      <div className="ahead"><b>Refunds</b>{refunds.length > 0 && <span className="muted">{gbp(refunds.reduce((t, r) => t + r.amount, 0))} of {gbp(total)} refunded</span>}</div>
      {refunds.map((r) => (
        <p key={r.id} style={{ margin: 0, fontSize: 13 }}>
          <b>{gbp(r.amount)}</b> on {new Date(r.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
          {r.by ? ` by ${r.by}` : ""}{r.status === "pending" ? " (pending at the bank)" : ""}{r.restocked ? ", items put back in stock" : ""}
          {r.pointsReversed ? `, ${r.pointsReversed} points taken back` : ""}{r.reason ? `. ${r.reason}` : ""}
        </p>
      ))}
      {refundable > 0 && !open && <div><button className="btn sm ghost" onClick={() => { setOpen(true); setAmount(refundable.toFixed(2)); }}>Refund…</button></div>}
      {refundable > 0 && open && (
        <div style={{ display: "grid", gap: 10, fontSize: 14 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="radio" checked={!part} onChange={() => setPart(false)} /> Everything left: <b>{gbp(refundable)}</b></label>
          <label style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><input type="radio" checked={part} onChange={() => setPart(true)} /> Part refund of £
            <input className="ain" type="number" min={0.01} max={refundable} step="0.01" value={amount} disabled={!part} onChange={(e) => setAmount(e.target.value)} style={{ width: 110 }} aria-label="Amount in pounds" /></label>
          {!part && <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} /> Put the items back in stock (only if they haven&apos;t been sent, or have come back unopened)</label>}
          <label style={{ display: "grid", gap: 4 }}>Reason (for the record)
            <input className="ain wide" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Arrived damaged" /></label>
          {err && <p role="alert" style={{ margin: 0, color: "var(--sale)" }}>{err}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn sm" disabled={busy || !valid} onClick={go}>{busy ? "Refunding…" : `Refund ${valid ? gbp(value) : ""}`}</button>
            <button className="btn sm ghost" onClick={() => setOpen(false)} disabled={busy}>Close</button>
          </div>
          <p className="muted" style={{ margin: 0 }}>The money goes back through Stripe to the card or wallet they paid with. Points earned on the order are taken back; on a full refund any points they spent are returned.</p>
        </div>
      )}
    </section>
  );
}
