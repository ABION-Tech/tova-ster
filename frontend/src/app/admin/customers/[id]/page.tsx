"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { adminJson } from "../../../../lib/backend";
import { STATUS, gbp } from "../../../../lib/admin/status";

interface Detail {
  customer: { id: string; email: string; first_name: string; last_name: string; phone: string | null; email_verified: boolean; created_at: string;
    points_balance: number; marketing_email: boolean; acquisition_source: string | null; birthday_day: number | null; birthday_month: number | null; erased_at: string | null };
  orders: { id: string; order_number: string; status: string; total: number; placed_at: string | null; created_at: string }[];
  points: { delta: number; reason: string; created_at: string; order_number: string | null; by: string | null }[];
  subscriptions: { id: string; product_name: string; quantity: number; interval_months: number; unit_price: number; status: string; next_charge_at: string }[];
  notes: { id: string; body: string; created_at: string; by: string | null }[];
  addresses: { label: string | null; full_name: string; line1: string; line2: string | null; city: string; postal_code: string; country: string; is_default: boolean }[];
  activity: { type: string; message: string; created_at: string }[];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const when = (t: string | null) => (t ? new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const day = (t: string) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Detail | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [pts, setPts] = useState({ delta: "", reason: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { adminJson<Detail>(`/admin/customers/${id}`).then(setD).catch((e: Error) => setMsg(e.message)); }, [id]);
  useEffect(() => { load(); }, [load]);

  async function run(fn: () => Promise<void>, done: string) {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg(done); load(); } catch (e) { setMsg(e instanceof Error ? e.message : "Something went wrong."); } finally { setBusy(false); }
  }

  if (!d) return <p className="muted">{msg ?? "Loading…"}</p>;
  const c = d.customer;
  const spent = d.orders.filter((o) => ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"].includes(o.status)).reduce((s, o) => s + o.total, 0);

  return (
    <>
      <p><Link href="/admin/customers" className="muted">← All customers</Link></p>
      <div className="ahead">
        <div><h1>{c.first_name} {c.last_name}</h1><p>{c.email}{c.phone ? ` · ${c.phone}` : ""} · joined {day(c.created_at)}</p></div>
      </div>
      {msg && <p className="note" role="status">{msg}</p>}

      <div className="kpis">
        <div className="kpi"><span>Orders</span><b>{d.orders.length}</b></div>
        <div className="kpi"><span>Spent</span><b>{gbp(spent)}</b></div>
        <div className="kpi"><span>Points</span><b>{c.points_balance}</b></div>
        <div className="kpi"><span>Subscriptions</span><b>{d.subscriptions.filter((s) => s.status === "active").length}</b><em className="muted">active</em></div>
        <div className="kpi"><span>Marketing emails</span><b>{c.marketing_email ? "Yes" : "No"}</b></div>
      </div>

      <div className="acols">
        <div className="acard">
          <h2>Orders</h2>
          <div className="tbl-wrap"><table className="t">
            <thead><tr><th>Order</th><th>Date</th><th>Status</th><th className="r">Total</th></tr></thead>
            <tbody>
              {d.orders.length === 0 && <tr><td colSpan={4} className="muted">No orders yet.</td></tr>}
              {d.orders.map((o) => (
                <tr key={o.id}><td><Link href={`/admin/orders/${o.id}`}><b>{o.order_number}</b></Link></td><td>{day(o.placed_at ?? o.created_at)}</td>
                  <td><span className={`pill ${STATUS[o.status]?.[1] ?? ""}`}>{STATUS[o.status]?.[0] ?? o.status}</span></td><td className="r">{gbp(o.total)}</td></tr>
              ))}
            </tbody>
          </table></div>
        </div>

        <div className="acard">
          <h2>Details</h2>
          <div className="muted" style={{ display: "grid", gap: 6, fontSize: 14 }}>
            <span>Email check: {c.email_verified ? "confirmed" : "not confirmed yet"}</span>
            <span>Birthday: {c.birthday_day && c.birthday_month ? `${c.birthday_day} ${MONTHS[c.birthday_month - 1]}` : "not given"}</span>
            <span>First came from: {c.acquisition_source ?? "not recorded"}</span>
          </div>
          <h2>Addresses</h2>
          {d.addresses.length === 0 ? <p className="muted">None saved.</p> : d.addresses.map((a, i) => (
            <p key={i} style={{ fontSize: 14, margin: 0 }}>{a.full_name}, {a.line1}{a.line2 ? `, ${a.line2}` : ""}, {a.city} {a.postal_code}{a.is_default ? " (default)" : ""}</p>
          ))}
        </div>
      </div>

      <div className="acols even">
        <div className="acard">
          <h2>Reward points</h2>
          <form style={{ display: "grid", gridTemplateColumns: "110px 1fr auto", gap: 8 }} onSubmit={(e) => { e.preventDefault(); run(async () => {
            await adminJson(`/admin/customers/${id}/points`, { method: "POST", body: JSON.stringify({ delta: Number(pts.delta), reason: pts.reason }) });
            setPts({ delta: "", reason: "" });
          }, "Points updated."); }}>
            <input className="ain wide" type="number" placeholder="+100 or -50" value={pts.delta} onChange={(e) => setPts({ ...pts, delta: e.target.value })} aria-label="Points to add or remove" required />
            <input className="ain wide" placeholder="Reason, e.g. late delivery" value={pts.reason} maxLength={200} onChange={(e) => setPts({ ...pts, reason: e.target.value })} aria-label="Reason" required />
            <button className="btn sm" disabled={busy}>Save</button>
          </form>
          <div className="tbl-wrap"><table className="t"><tbody>
            {d.points.length === 0 && <tr><td className="muted">No points history yet.</td></tr>}
            {d.points.map((p, i) => (
              <tr key={i}><td>{day(p.created_at)}</td><td>{p.reason}{p.order_number && !p.reason.includes(p.order_number) ? ` (${p.order_number})` : ""}{p.by ? <span className="muted"> by {p.by}</span> : ""}</td>
                <td className="r"><b className={p.delta > 0 ? "up" : "down"}>{p.delta > 0 ? "+" : ""}{p.delta}</b></td></tr>
            ))}
          </tbody></table></div>
        </div>

        <div className="acard">
          <h2>Team notes</h2>
          <form style={{ display: "grid", gap: 8 }} onSubmit={(e) => { e.preventDefault(); run(async () => {
            await adminJson(`/admin/customers/${id}/notes`, { method: "POST", body: JSON.stringify({ body: note }) }); setNote("");
          }, "Note added."); }}>
            <textarea className="ain wide" placeholder="Only the team sees these notes" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} aria-label="New note" required />
            <div><button className="btn sm" disabled={busy}>Add note</button></div>
          </form>
          {d.notes.length === 0 ? <p className="muted">No notes yet.</p> : d.notes.map((n) => (
            <div key={n.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
              <p style={{ margin: 0, fontSize: 14, whiteSpace: "pre-wrap" }}>{n.body}</p>
              <span className="muted">{n.by ?? "Team"}, {when(n.created_at)}</span>
            </div>
          ))}
        </div>
      </div>

      {d.subscriptions.length > 0 && (
        <div className="acard">
          <h2>Subscriptions</h2>
          <div className="tbl-wrap"><table className="t">
            <thead><tr><th>Product</th><th>Every</th><th>Status</th><th>Next delivery</th><th className="r">Price</th></tr></thead>
            <tbody>{d.subscriptions.map((s) => (
              <tr key={s.id}><td>{s.quantity} × {s.product_name}</td><td>{s.interval_months} month{s.interval_months === 1 ? "" : "s"}</td>
                <td><span className={`pill ${s.status === "active" ? "active" : "paused"}`}>{s.status}</span></td><td>{day(s.next_charge_at)}</td><td className="r">{gbp(s.unit_price)}</td></tr>
            ))}</tbody>
          </table></div>
        </div>
      )}

      <div className="acard">
        <h2>Recent activity</h2>
        <div className="tbl-wrap"><table className="t"><tbody>
          {d.activity.length === 0 && <tr><td className="muted">Nothing recorded yet. Browsing is only recorded for customers who accepted all cookies.</td></tr>}
          {d.activity.map((a, i) => <tr key={i}><td style={{ whiteSpace: "nowrap" }}>{when(a.created_at)}</td><td><span className="pill paused">{a.type}</span></td><td>{a.message}</td></tr>)}
        </tbody></table></div>
      </div>
    </>
  );
}
