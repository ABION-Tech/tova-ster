"use client";

import { useEffect, useState } from "react";
import { adminJson } from "../../../lib/backend";

type Emails = Record<string, unknown> & {
  welcome: boolean; dispatched: boolean; delivered: boolean; basket: boolean; basketSteps: number[]; basketCodeOn: boolean; basketCode: number;
  subReminder: boolean; points: boolean; review: boolean; backInStock: boolean; winback: boolean; winbackDays: number;
  basketAfterHours: number; adminNewOrder: boolean; adminLowStock: boolean;
};

// "live" = sends today when the event happens; "soon" = the timed sender is still being built (tracker T-073).
const ROWS: { key: keyof Emails; title: string; text: string; when: "live" | "soon" }[] = [
  { key: "dispatched", title: "Order dispatched", text: "With the tracking number, when the order is marked dispatched.", when: "live" },
  { key: "delivered", title: "Order delivered", text: "When the order is marked delivered.", when: "live" },
  { key: "adminNewOrder", title: "Team: new order", text: "Emails the team when an order is paid.", when: "live" },
  { key: "adminLowStock", title: "Team: low stock", text: "Emails the team when a sale takes a product down to its alert level.", when: "live" },
  { key: "welcome", title: "Welcome", text: "Straight after someone creates an account, with their sign-up points and the vitamin finder.", when: "live" },
  { key: "basket", title: "Basket reminders", text: "To shoppers who agreed to emails and left items in their basket. Stops once they buy. The code goes in the last reminder and is one-use, for 7 days.", when: "live" },
  { key: "subReminder", title: "Subscription reminder", text: "A few days before each subscription charge and delivery (the days are set under Dispatch), with a link to skip or change it.", when: "live" },
  { key: "points", title: "Points update", text: "At most once a month, to customers who agreed to emails and have enough points to spend.", when: "live" },
  { key: "review", title: "Review request", text: "Three days after delivery, for products the customer hasn't reviewed yet.", when: "live" },
  { key: "backInStock", title: "Back in stock", text: "Once, to people who asked on a sold-out product page. Their address is then dropped.", when: "live" },
  { key: "winback", title: "We miss you", text: "Once per customer per last order, to those who agreed to emails, have no active subscription and haven't ordered for a while.", when: "live" },
];

export default function EmailsAdmin() {
  const [e, setE] = useState<Emails | null>(null);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { adminJson<{ settings: { emails: Emails } }>("/admin/settings").then((d) => setE(d.settings.emails)).catch((x: Error) => setMsg(x.message)); }, []);
  const set = (patch: Partial<Emails>) => { setE((cur) => (cur ? { ...cur, ...patch } : cur)); setDirty(true); setMsg(null); };

  async function save() {
    if (!e) return;
    setBusy(true); setMsg(null);
    try {
      const d = await adminJson<{ settings: { emails: Emails } }>("/admin/settings/emails", { method: "PUT", body: JSON.stringify({ value: e }) });
      setE(d.settings.emails); setDirty(false); setMsg("Saved.");
    } catch (x) { setMsg(x instanceof Error ? x.message : "Couldn't save."); } finally { setBusy(false); }
  }

  if (!e) return <p className="muted">{msg ?? "Loading…"}</p>;
  return (
    <>
      <div className="ahead">
        <div><h1>Emails</h1><p>Switch each email on or off. Order confirmations, password resets and email checks always send.</p></div>
        <button className="btn sm" disabled={busy || !dirty} onClick={save}>{busy ? "Saving…" : dirty ? "Save changes" : "Saved"}</button>
      </div>
      {msg && <p className="note" role="status">{msg}</p>}
      <p className="note">Emails go out once the email account (Resend) is verified for mail.tova-ster.com. Until then they are recorded in the activity log but not delivered. Emails marked &ldquo;Coming soon&rdquo; keep your choice and start once their timed sender is built.</p>

      <div className="features">
        {ROWS.map((r) => (
          <div key={String(r.key)} className={`feat${e[r.key] ? "" : " off"}`}>
            <div className="fh">
              <div className="grow">
                <h3>{r.title} {r.when === "soon" && <span className="pill paused" style={{ marginLeft: 6 }}>Coming soon</span>}</h3>
                <p>{r.text}</p>
                {r.key === "basket" && e.basket && (
                  <div style={{ display: "grid", gap: 8, marginTop: 10, fontSize: 14 }}>
                    <label>Send after (days, comma separated)
                      <input className="ain wide" value={e.basketSteps.join(", ")} onChange={(x) => set({ basketSteps: x.target.value.split(",").map((n) => Math.round(Number(n.trim()))).filter((n) => n > 0 && n <= 30).slice(0, 3) })} />
                    </label>
                    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input type="checkbox" checked={e.basketCodeOn} onChange={(x) => set({ basketCodeOn: x.target.checked })} /> Include a code for
                      <input className="ain" type="number" min={1} max={50} value={e.basketCode} onChange={(x) => set({ basketCode: Number(x.target.value) })} />% off
                    </label>
                  </div>
                )}
                {r.key === "winback" && e.winback && (
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, marginTop: 10 }}>After
                    <input className="ain" type="number" min={14} max={365} value={e.winbackDays} onChange={(x) => set({ winbackDays: Number(x.target.value) })} /> days without an order
                  </label>
                )}
              </div>
              <label className="switch" aria-label={`${r.title} on`}>
                <input type="checkbox" checked={Boolean(e[r.key])} onChange={(x) => set({ [r.key]: x.target.checked } as Partial<Emails>)} /><span />
              </label>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
