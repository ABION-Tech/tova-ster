"use client";

import { Funnel } from "../../../components/admin/Funnel";
import { useEffect, useState } from "react";
import { adminJson } from "../../../lib/backend";

interface Freebie { on: boolean; title: string; text: string; button: string; fileUrl: string; cover: { src: string; kind: "image" | "video" } | null; popup: boolean; delaySec: number; exitIntent: boolean; remindDays: number; giveCode: boolean }
interface Features { freebie: Freebie; welcome: { on: boolean; pct: number; code: string }; birthday: { on: boolean; points: number }; rewards: { on: boolean }; [k: string]: unknown }
interface Reports { channels: { channel: string; orders: number; sales: number }[]; searches: { words: string; times: number; no_results: boolean }[] }
interface Signups { totals: { source: string; total: number; week: number }[]; recent: { email: string; source: string; consent_at: string }[] }

const box: React.CSSProperties = { border: "1px solid #E2DFD9", borderRadius: 12, padding: 18, display: "grid", gap: 10, background: "#fff" };
const row: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 };
const lab: React.CSSProperties = { display: "grid", gap: 4, fontSize: 13 };
const tick: React.CSSProperties = { display: "flex", gap: 8, alignItems: "center", fontSize: 13 };
const inp: React.CSSProperties = { padding: 8, border: "1px solid #D5D1CA", borderRadius: 8, font: "inherit" };
const SOURCE: Record<string, string> = { freebie: "Free guide", footer: "Newsletter", checkout: "Checkout", signup: "New account", other: "Other" };

export default function GrowthAdmin() {
  const [features, setFeatures] = useState<Features | null>(null);
  const [subs, setSubs] = useState<Signups | null>(null);
  const [rep, setRep] = useState<Reports>({ channels: [], searches: [] });
  const [alerts, setAlerts] = useState<{ emails: Record<string, unknown>; business: Record<string, unknown> } | null>(null);
  const [alertMsg, setAlertMsg] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    adminJson<{ settings: { features: Features; emails: Record<string, unknown>; business: Record<string, unknown> } }>("/admin/settings").then((d) => { setFeatures(d.settings.features); setAlerts({ emails: d.settings.emails, business: d.settings.business }); }).catch((e) => setMsg(e.message));
    adminJson<Signups>("/admin/newsletter").then(setSubs).catch(() => {});
    Promise.all([
      adminJson<{ channels: Reports["channels"] }>("/admin/reports/channels").catch(() => ({ channels: [] })),
      adminJson<{ searches: Reports["searches"] }>("/admin/reports/searches").catch(() => ({ searches: [] })),
    ]).then(([c, s]) => setRep({ channels: c.channels, searches: s.searches }));
  }, []);

  if (!features) return <p>{msg ?? "Loading…"}</p>;
  const f = features.freebie;
  const set = (patch: Partial<Freebie>) => { setFeatures({ ...features, freebie: { ...f, ...patch } }); setDirty(true); setMsg(null); };
  const num = (v: string, lo: number, hi: number, d: number) => Math.min(hi, Math.max(lo, Number(v) || d));
  const guide = subs?.totals.find((t) => t.source === "freebie");
  const all = subs?.totals.reduce((a, t) => a + t.total, 0) ?? 0;

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const d = await adminJson<{ settings: { features: Features } }>("/admin/settings/features", { method: "PUT", body: JSON.stringify({ value: features }) });
      setFeatures(d.settings.features); setDirty(false);
      setMsg("Saved. The shop shows the change within a minute.");
    } catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't save."); } finally { setBusy(false); }
  }

  function exportCsv() {
    if (!subs) return;
    const lines = ["email,source,signed_up", ...subs.recent.map((r) => `${r.email},${SOURCE[r.source] ?? r.source},${new Date(r.consent_at).toISOString()}`)];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = "tova-ster-sign-ups.csv"; a.click();
  }

  return (
    <div style={{ display: "grid", gap: 20, maxWidth: 1000 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Growth tools</h1>
        <button className="btn" disabled={busy || !dirty} onClick={save}>{busy ? "Saving…" : dirty ? "Save changes" : "Saved"}</button>
      </div>
      {msg && <div style={{ padding: 12, borderRadius: 8, background: "#F4EAD3" }} role="status">{msg}</div>}

      <section style={{ ...row, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        {[["Free guide sign-ups", guide?.total ?? 0], ["…in the last 7 days", guide?.week ?? 0], ["All email sign-ups", all]].map(([k, v]) => (
          <div key={k as string} style={box}><span style={{ fontSize: 13, color: "#6E685E" }}>{k}</span><b style={{ fontSize: 28 }}>{v}</b></div>
        ))}
      </section>

      <section style={box}>
        <label style={{ ...tick, fontWeight: 600 }}><input type="checkbox" checked={f.on} onChange={(e) => set({ on: e.target.checked })} /> Free guide offer is on</label>
        <span style={{ fontSize: 13, color: "#6E685E" }}>Shoppers give their email (with consent) and get the guide by email and as a download. It shows on the homepage, and in a pop-up if you turn that on.</span>
        <label style={lab}>Title<input style={inp} value={f.title} maxLength={90} onChange={(e) => set({ title: e.target.value })} /></label>
        <label style={lab}>Description<textarea style={{ ...inp, minHeight: 64 }} value={f.text} maxLength={300} onChange={(e) => set({ text: e.target.value })} /></label>
        <div style={row}>
          <label style={lab}>Button text<input style={inp} value={f.button} maxLength={40} onChange={(e) => set({ button: e.target.value })} /></label>
          <label style={lab}>Guide file (link)<input style={inp} value={f.fileUrl} onChange={(e) => set({ fileUrl: e.target.value.trim() })} /></label>
          <label style={lab}>Cover picture (link, optional)<input style={inp} value={f.cover?.src ?? ""} placeholder="https://…" onChange={(e) => { const v = e.target.value.trim(); set({ cover: v ? { src: v, kind: "image" } : null }); }} /></label>
        </div>
        <a href={f.fileUrl} target="_blank" rel="noopener" style={{ fontSize: 13 }}>Open the current guide</a>
      </section>

      <section style={box}>
        <b>Pop-up</b>
        <label style={tick}><input type="checkbox" checked={f.popup} onChange={(e) => set({ popup: e.target.checked })} /> Also offer it in a pop-up (never on checkout or account pages)</label>
        <div style={row}>
          <label style={lab}>Show after (seconds)<input style={inp} type="number" min={5} max={300} value={f.delaySec} disabled={!f.popup} onChange={(e) => set({ delaySec: num(e.target.value, 5, 300, 25) })} /></label>
          <label style={lab}>After &ldquo;No thanks&rdquo;, ask again after (days)<input style={inp} type="number" min={1} max={365} value={f.remindDays} disabled={!f.popup} onChange={(e) => set({ remindDays: num(e.target.value, 1, 365, 14) })} /></label>
        </div>
        <label style={tick}><input type="checkbox" checked={f.exitIntent} disabled={!f.popup} onChange={(e) => set({ exitIntent: e.target.checked })} /> Show it sooner when a desktop visitor moves to leave</label>
        <label style={tick}><input type="checkbox" checked={f.giveCode} onChange={(e) => set({ giveCode: e.target.checked })} /> Give the welcome code after sign-up {features.welcome.on ? `(${features.welcome.code}, ${features.welcome.pct}% off the first order)` : "(the welcome offer is off, so no code is shown)"}</label>
      </section>

      {alerts && (
        <section style={box}>
          <b>Team alerts</b>
          <label style={tick}><input type="checkbox" checked={alerts.emails.adminNewOrder !== false} onChange={(e) => setAlerts({ ...alerts, emails: { ...alerts.emails, adminNewOrder: e.target.checked } })} /> Email the team when an order is paid</label>
          <label style={tick}><input type="checkbox" checked={alerts.emails.adminLowStock !== false} onChange={(e) => setAlerts({ ...alerts, emails: { ...alerts.emails, adminLowStock: e.target.checked } })} /> Email the team when a sale takes stock down to its low-stock level</label>
          <label style={{ ...lab, maxWidth: 360 }}>Send alerts to<input style={inp} type="email" value={String(alerts.business.alertEmail ?? "")} onChange={(e) => setAlerts({ ...alerts, business: { ...alerts.business, alertEmail: e.target.value } })} /></label>
          <div><button className="btn" onClick={async () => {
            setAlertMsg(null);
            try {
              await adminJson("/admin/settings/emails", { method: "PUT", body: JSON.stringify({ value: alerts.emails }) });
              await adminJson("/admin/settings/business", { method: "PUT", body: JSON.stringify({ value: alerts.business }) });
              setAlertMsg("Alert settings saved.");
            } catch (e) { setAlertMsg(e instanceof Error ? e.message : "Couldn't save."); }
          }}>Save alert settings</button></div>
          {alertMsg && <span style={{ fontSize: 13 }} role="status">{alertMsg}</span>}
          <span style={{ fontSize: 13, color: "#6E685E" }}>Only the Owner can change the address. Alerts are sent once Resend is connected.</span>
        </section>
      )}

      <section style={box}>
        <b>Birthday treat</b>
        <label style={tick}><input type="checkbox" checked={features.birthday.on} onChange={(e) => { setFeatures({ ...features, birthday: { ...features.birthday, on: e.target.checked } }); setDirty(true); }} /> Ask for a birthday (day and month, optional) and send a treat on the day</label>
        <label style={{ ...lab, maxWidth: 260 }}>Birthday points{features.rewards.on ? "" : " (reward points are off)"}<input style={inp} type="number" min={0} max={5000} step={50} value={features.birthday.points} disabled={!features.birthday.on || !features.rewards.on} onChange={(e) => { setFeatures({ ...features, birthday: { ...features.birthday, points: num(e.target.value, 0, 5000, 200) } }); setDirty(true); }} /></label>
        <span style={{ fontSize: 13, color: "#6E685E" }}>Sent once a year on the customer&apos;s birthday (UK date) with a birthday email. 29 February birthdays are celebrated on 28 February in other years.</span>
      </section>

      <Funnel />

      <section style={box}>
        <b>Where paying customers came from (last 30 days)</b>
        {rep.channels.length === 0 ? <span style={{ fontSize: 13, color: "#6E685E" }}>No paid orders with a known source yet. Sources are recorded for shoppers who accept analytics cookies.</span> : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}><thead><tr style={{ textAlign: "left", color: "#6E685E" }}><th style={{ padding: 6 }}>Source</th><th style={{ padding: 6 }}>Orders</th><th style={{ padding: 6 }}>Sales</th></tr></thead>
            <tbody>{rep.channels.map((c) => <tr key={c.channel} style={{ borderTop: "1px solid #EEE" }}><td style={{ padding: 6 }}>{c.channel}</td><td style={{ padding: 6 }}>{c.orders}</td><td style={{ padding: 6 }}>£{c.sales.toFixed(2)}</td></tr>)}</tbody></table>
        )}
      </section>

      <section style={box}>
        <b>What people searched for (last 30 days)</b>
        {rep.searches.length === 0 ? <span style={{ fontSize: 13, color: "#6E685E" }}>No searches recorded yet.</span> : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}><thead><tr style={{ textAlign: "left", color: "#6E685E" }}><th style={{ padding: 6 }}>Words</th><th style={{ padding: 6 }}>Times</th><th style={{ padding: 6 }}>Found anything?</th></tr></thead>
            <tbody>{rep.searches.map((s) => <tr key={s.words} style={{ borderTop: "1px solid #EEE" }}><td style={{ padding: 6 }}>{s.words}</td><td style={{ padding: 6 }}>{s.times}</td><td style={{ padding: 6, color: s.no_results ? "#B42318" : undefined }}>{s.no_results ? "Nothing found" : "Yes"}</td></tr>)}</tbody></table>
        )}
      </section>

      <section style={box}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <b>Latest sign-ups</b>
          <button className="btn" disabled={!subs?.recent.length} onClick={exportCsv}>Download CSV</button>
        </div>
        {!subs ? <span>Loading…</span> : subs.recent.length === 0 ? <span style={{ fontSize: 13, color: "#6E685E" }}>No sign-ups yet.</span> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ textAlign: "left", color: "#6E685E" }}><th style={{ padding: 6 }}>Email</th><th style={{ padding: 6 }}>From</th><th style={{ padding: 6 }}>Signed up</th></tr></thead>
              <tbody>{subs.recent.map((r) => (
                <tr key={r.email} style={{ borderTop: "1px solid #EEE" }}><td style={{ padding: 6 }}>{r.email}</td><td style={{ padding: 6 }}>{SOURCE[r.source] ?? r.source}</td><td style={{ padding: 6 }}>{new Date(r.consent_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
