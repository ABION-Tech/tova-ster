"use client";

import { useCallback, useEffect, useState } from "react";
import { adminJson } from "../../../lib/backend";

interface Basket { id: string; email: string | null; name: string | null; guest: boolean; postcode: string | null; can_email: boolean; last_activity_at: string; value: number; items: { name: string; qty: number; sub: boolean }[] | null }
interface Report { hours: number; days: number; count: number; value: number; contactable: number; baskets: Basket[] }

const box: React.CSSProperties = { border: "1px solid #E2DFD9", borderRadius: 12, padding: 18, display: "grid", gap: 10, background: "#fff" };
const inp: React.CSSProperties = { padding: 8, border: "1px solid #D5D1CA", borderRadius: 8, font: "inherit", width: 90 };
const ago = (t: string) => {
  const h = Math.floor((Date.now() - new Date(t).getTime()) / 3600000);
  return h < 48 ? `${h} hours ago` : `${Math.floor(h / 24)} days ago`;
};

export default function BasketsAdmin() {
  const [days, setDays] = useState(30);
  const [rep, setRep] = useState<Report | null>(null);
  const [hours, setHours] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    adminJson<Report>(`/admin/baskets?days=${days}`).then((r) => { setRep(r); setHours((h) => h ?? r.hours); }).catch((e) => setMsg(e.message));
  }, [days]);
  useEffect(() => { load(); }, [load]);

  async function saveHours() {
    if (!hours || hours < 1) return;
    setMsg(null);
    try {
      const s = await adminJson<{ settings: { emails: Record<string, unknown> } }>("/admin/settings");
      await adminJson("/admin/settings/emails", { method: "PUT", body: JSON.stringify({ value: { ...s.settings.emails, basketAfterHours: hours } }) });
      setMsg(`Saved. Baskets now count as abandoned after ${hours} hours.`);
      load();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't save."); }
  }

  if (!rep) return <p>{msg ?? "Loading…"}</p>;
  return (
    <div style={{ display: "grid", gap: 20, maxWidth: 1100 }}>
      <h1 style={{ margin: 0 }}>Abandoned baskets</h1>
      {msg && <div style={{ padding: 12, borderRadius: 8, background: "#F4EAD3" }} role="status">{msg}</div>}

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
        {[["Abandoned baskets", rep.count], ["Value at full price", `£${rep.value.toFixed(2)}`], ["We may email", rep.contactable]].map(([k, v]) => (
          <div key={k as string} style={box}><span style={{ fontSize: 13, color: "#6E685E" }}>{k}</span><b style={{ fontSize: 28 }}>{v}</b></div>
        ))}
      </section>

      <section style={{ ...box, gridTemplateColumns: "1fr", gap: 12 }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "end" }}>
          <label style={{ display: "grid", gap: 4, fontSize: 13 }}>Show the last
            <select style={{ ...inp, width: 140 }} value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {[7, 30, 90].map((d) => <option key={d} value={d}>{d} days</option>)}
            </select></label>
          <label style={{ display: "grid", gap: 4, fontSize: 13 }}>Abandoned after (hours untouched)
            <span style={{ display: "flex", gap: 8 }}><input style={inp} type="number" min={1} max={720} value={hours ?? ""} onChange={(e) => setHours(Number(e.target.value))} />
              <button className="btn" onClick={saveHours} disabled={hours === rep.hours}>Save</button></span></label>
        </div>
        <span style={{ fontSize: 13, color: "#6E685E" }}>A basket counts as abandoned when it has items, hasn&apos;t been checked out and nobody has touched it for {rep.hours} hours. &ldquo;We may email&rdquo; means the shopper agreed to marketing emails. Reminder emails start once Resend is connected.</span>
      </section>

      <section style={box}>
        {rep.baskets.length === 0 ? <span style={{ fontSize: 13, color: "#6E685E" }}>No abandoned baskets in the last {rep.days} days.</span> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ textAlign: "left", color: "#6E685E" }}>
                <th style={{ padding: 6 }}>Shopper</th><th style={{ padding: 6 }}>In the basket</th><th style={{ padding: 6 }}>Value</th><th style={{ padding: 6 }}>Last touched</th><th style={{ padding: 6 }}>May email?</th>
              </tr></thead>
              <tbody>{rep.baskets.map((b) => (
                <tr key={b.id} style={{ borderTop: "1px solid #EEE", verticalAlign: "top" }}>
                  <td style={{ padding: 6 }}>{b.name ?? (b.guest ? "Guest" : "Customer")}<br /><span style={{ color: "#6E685E" }}>{b.email ?? "No email yet"}{b.postcode ? ` · ${b.postcode}` : ""}</span></td>
                  <td style={{ padding: 6 }}>{(b.items ?? []).map((i) => `${i.qty} × ${i.name}${i.sub ? " (subscription)" : ""}`).join(", ")}</td>
                  <td style={{ padding: 6 }}>£{Number(b.value).toFixed(2)}</td>
                  <td style={{ padding: 6 }}>{ago(b.last_activity_at)}</td>
                  <td style={{ padding: 6 }}>{b.email ? (b.can_email ? "Yes" : "No consent") : "No email"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
