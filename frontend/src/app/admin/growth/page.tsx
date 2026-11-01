"use client";

import Link from "next/link";
import { Funnel } from "../../../components/admin/Funnel";
import { useCallback, useEffect, useRef, useState } from "react";
import { adminJson } from "../../../lib/backend";
import { useAdmin } from "../../../lib/admin/AdminContext";

/**
 * Growth tools, laid out like the demo: one card per feature, each with an
 * on/off switch and its own settings. Changes save on their own (a moment
 * after the last change) and the shop picks them up within a minute.
 */

interface Freebie { on: boolean; title: string; text: string; button: string; fileUrl: string; cover: { src: string; kind: "image" | "video" } | null; popup: boolean; delaySec: number; exitIntent: boolean; remindDays: number; giveCode: boolean }
interface Features {
  announcement: { on: boolean; messages: string[] };
  freeDelivery: { on: boolean; threshold: number };
  subscribe: { on: boolean; discount: number; freqs: number[] };
  multibuy: { on: boolean; mode: "3for2" | "2save10" | "3save20" };
  bundles: { on: boolean };
  rewards: { on: boolean; earn: number; pointValue: number; signup: number; minRedeem: number };
  quiz: { on: boolean; discount: number; max: number };
  codes: { on: boolean };
  welcome: { on: boolean; pct: number; code: string };
  crossSell: { on: boolean };
  reviews: { on: boolean };
  stockUrgency: { on: boolean; under: number };
  birthday: { on: boolean; points: number };
  freebie: Freebie;
  [k: string]: unknown;
}
type FeatKey = "subscribe" | "multibuy" | "rewards" | "birthday" | "quiz" | "freebie" | "freeDelivery" | "announcement" | "welcome" | "bundles" | "codes" | "crossSell" | "stockUrgency" | "reviews";
interface Growth { subscriptions: { active: number; perMonth: number }; points: number; avgOrder: number | null; orders7: number; bundles: { live: number; total: number }; codesLive: number }
interface Reports { channels: { channel: string; orders: number; sales: number }[]; searches: { words: string; times: number; no_results: boolean }[] }
interface Signups { totals: { source: string; total: number; week: number }[]; recent: { email: string; source: string; consent_at: string }[] }
type Alerts = { emails: Record<string, unknown>; business: Record<string, unknown> };

const SOURCE: Record<string, string> = { freebie: "Free guide", footer: "Newsletter", homepage: "Newsletter", coming_soon: "Launch page", checkout: "Checkout", signup: "New account", other: "Other" };
const gbp = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Switch({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <span className="switch">
      <input type="checkbox" role="switch" aria-label={label} checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </span>
  );
}

/** A number box that lets people clear and retype; commits a clamped number. */
function Num({ id, label, value, onChange, min = 0, max = 100000, step = 1, disabled }: { id: string; label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; disabled?: boolean }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = (raw: string) => {
    const n = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(n)) { setText(String(value)); return; }
    const c = Math.min(max, Math.max(min, n));
    setText(String(c));
    if (c !== value) onChange(c);
  };
  return (
    <div className="frow">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="ain" type="number" inputMode="decimal" min={min} max={max} step={step} value={text} disabled={disabled}
        onChange={(e) => { setText(e.target.value); const n = Number(e.target.value); if (e.target.value.trim() !== "" && Number.isFinite(n) && n >= min && n <= max) onChange(n); }}
        onBlur={(e) => commit(e.target.value)} />
    </div>
  );
}

function Feat({ k, title, desc, on, onToggle, children, impact }: { k: string; title: string; desc: string; on: boolean; onToggle: (v: boolean) => void; children?: React.ReactNode; impact?: React.ReactNode }) {
  return (
    <section className={`feat${on ? "" : " off"}`} aria-labelledby={`f-${k}`}>
      <div className="fh">
        <div className="grow"><h3 id={`f-${k}`}>{title}</h3><p>{desc}</p></div>
        <Switch on={on} label={`${title}: ${on ? "on" : "off"}`} onChange={onToggle} />
      </div>
      {(children || impact) && (
        <div className="fb">
          {children}
          {impact && <div className="impact">{impact}</div>}
        </div>
      )}
    </section>
  );
}

export default function GrowthAdmin() {
  const { admin } = useAdmin();
  const isOwner = admin?.role === "Owner";
  const [features, setFeatures] = useState<Features | null>(null);
  const [alerts, setAlerts] = useState<Alerts | null>(null);
  const [g, setG] = useState<Growth | null>(null);
  const [subs, setSubs] = useState<Signups | null>(null);
  const [rep, setRep] = useState<Reports>({ channels: [], searches: [] });
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Features | null>(null);

  useEffect(() => {
    adminJson<{ settings: { features: Features; emails: Record<string, unknown>; business: Record<string, unknown> } }>("/admin/settings")
      .then((d) => { setFeatures(d.settings.features); setAlerts({ emails: d.settings.emails, business: d.settings.business }); })
      .catch((e) => setErr(e.message));
    adminJson<Growth>("/admin/reports/growth").then(setG).catch(() => {});
    adminJson<Signups>("/admin/newsletter").then(setSubs).catch(() => {});
    Promise.all([
      adminJson<{ channels: Reports["channels"] }>("/admin/reports/channels").catch(() => ({ channels: [] })),
      adminJson<{ searches: Reports["searches"] }>("/admin/reports/searches").catch(() => ({ searches: [] })),
    ]).then(([c, s]) => setRep({ channels: c.channels, searches: s.searches }));
  }, []);

  const flush = useCallback(async () => {
    const value = pending.current;
    if (!value) return;
    pending.current = null;
    setState("saving");
    try {
      await adminJson("/admin/settings/features", { method: "PUT", body: JSON.stringify({ value }) });
      setState(pending.current ? "saving" : "saved"); setErr(null);
    } catch (e) { setState("error"); setErr(e instanceof Error ? e.message : "Couldn't save."); }
  }, []);

  // Save a moment after the last change, and straight away if the page is left.
  useEffect(() => {
    const leave = () => { if (pending.current) void flush(); };
    window.addEventListener("pagehide", leave);
    return () => { window.removeEventListener("pagehide", leave); leave(); };
  }, [flush]);

  if (!features) return <p className="muted">{err ?? "Loading…"}</p>;

  function update(next: Features) {
    setFeatures(next);
    pending.current = next;
    setState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 600);
  }
  function set<K extends FeatKey>(key: K, patch: Partial<Features[K]>) {
    update({ ...features!, [key]: { ...(features![key] as object), ...patch } } as Features);
  }
  async function saveAlerts(next: Alerts, which: "emails" | "business") {
    setAlerts(next);
    setState("saving");
    try {
      await adminJson(`/admin/settings/${which}`, { method: "PUT", body: JSON.stringify({ value: next[which] }) });
      setState("saved"); setErr(null);
    } catch (e) { setState("error"); setErr(e instanceof Error ? e.message : "Couldn't save."); }
  }

  const F = features;
  const guide = subs?.totals.find((t) => t.source === "freebie");
  const allSignups = subs?.totals.reduce((a, t) => a + t.total, 0) ?? 0;
  const pointsWorth = g ? (g.points * F.rewards.pointValue) / 100 : 0;
  const messages = F.announcement.messages;

  function exportCsv() {
    if (!subs) return;
    const lines = ["email,source,signed_up", ...subs.recent.map((r) => `${r.email},${SOURCE[r.source] ?? r.source},${new Date(r.consent_at).toISOString()}`)];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = "tova-ster-sign-ups.csv"; a.click();
  }

  return (
    <>
      <div className="ahead">
        <div><h1>Growth tools</h1><p>Switch each feature on or off and set how it works. Changes save on their own and show in the shop within a minute.</p></div>
        <div className="aheadact">
          <span className={`savestate ${state}`} role="status" aria-live="polite">
            {state === "saving" ? "Saving…" : state === "saved" ? "All changes saved" : state === "error" ? "Not saved" : ""}
          </span>
          <a className="btn sm gold" href="/" target="_blank" rel="noopener">Preview the shop</a>
        </div>
      </div>
      {err && <div className="notice warn" role="alert">{err}</div>}

      <div className="features">
        <Feat k="subscribe" title="Subscribe & Save" desc="Repeat deliveries at a discount, charged to the saved card each time." on={F.subscribe.on} onToggle={(on) => set("subscribe", { on })}
          impact={g && <><b>{g.subscriptions.active} active</b> subscriptions, about <b>{gbp(g.subscriptions.perMonth)}</b> a month.</>}>
          <Num id="sub-d" label="Discount (%)" value={F.subscribe.discount} min={0} max={50} onChange={(discount) => set("subscribe", { discount })} />
          <div className="frow"><span>Frequencies offered</span>
            <span className="chips">{[1, 2, 3, 6].map((m) => {
              const pressed = F.subscribe.freqs.includes(m);
              return <button key={m} type="button" className="chip" aria-pressed={pressed}
                onClick={() => { const next = pressed ? F.subscribe.freqs.filter((x) => x !== m) : [...F.subscribe.freqs, m].sort((a, b) => a - b); if (next.length) set("subscribe", { freqs: next }); }}>
                {m === 1 ? "Monthly" : `${m} months`}</button>;
            })}</span>
          </div>
        </Feat>

        <Feat k="multibuy" title="Multi-buy offer" desc="A saving applied in the basket when people buy more than one." on={F.multibuy.on} onToggle={(on) => set("multibuy", { on })}
          impact="Applies to one-time items. Subscriptions and bundles keep their own saving, so discounts never stack.">
          <div className="frow"><label htmlFor="mb-mode">Offer</label>
            <select id="mb-mode" className="ain" style={{ width: 210 }} value={F.multibuy.mode} onChange={(e) => set("multibuy", { mode: e.target.value as Features["multibuy"]["mode"] })}>
              <option value="3for2">3 for 2 (cheapest free)</option><option value="2save10">Buy 2, save 10%</option><option value="3save20">Buy 3, save 20%</option>
            </select>
          </div>
        </Feat>

        <Feat k="rewards" title="Reward points" desc="Points for every pound, spent as money off." on={F.rewards.on} onToggle={(on) => set("rewards", { on })}
          impact={g ? <>Customers hold <b>{g.points.toLocaleString("en-GB")}</b> points, worth <b>{gbp(pointsWorth)}</b>. Effective reward: <b>{(F.rewards.earn * F.rewards.pointValue).toFixed(1)}%</b> back.</> : undefined}>
          <Num id="rw-e" label="Points per £1 spent" value={F.rewards.earn} max={100} onChange={(earn) => set("rewards", { earn })} />
          <Num id="rw-v" label="Value of 100 points (£)" value={F.rewards.pointValue} max={100} step={0.5} onChange={(pointValue) => set("rewards", { pointValue })} />
          <Num id="rw-s" label="Points for creating an account" value={F.rewards.signup} max={10000} onChange={(signup) => set("rewards", { signup })} />
          <Num id="rw-m" label="Minimum points to spend" value={F.rewards.minRedeem} max={100000} step={100} onChange={(minRedeem) => set("rewards", { minRedeem })} />
        </Feat>

        <Feat k="birthday" title="Birthday treat" desc="Customers can add their birthday (day and month only, no year). On the day they get points and a birthday email." on={F.birthday.on} onToggle={(on) => set("birthday", { on })}
          impact={<>{F.rewards.on ? `Worth ${gbp((F.birthday.points * F.rewards.pointValue) / 100)} off.` : "Reward points are off, so only the email is sent."} 29 February birthdays are celebrated on 28 February in other years.</>}>
          <Num id="bd-p" label="Birthday points" value={F.birthday.points} max={5000} step={50} disabled={!F.rewards.on} onChange={(points) => set("birthday", { points })} />
        </Feat>

        {alerts && (
          <section className="feat" aria-labelledby="f-alerts">
            <div className="fh"><div className="grow"><h3 id="f-alerts">Team alerts</h3><p>Emails the team when an order is paid, and when a sale takes a product down to its low-stock level.</p></div></div>
            <div className="fb">
              <div className="frow"><span>New paid order</span><Switch on={alerts.emails.adminNewOrder !== false} label="Email on each paid order" onChange={(v) => void saveAlerts({ ...alerts, emails: { ...alerts.emails, adminNewOrder: v } }, "emails")} /></div>
              <div className="frow"><span>Low stock</span><Switch on={alerts.emails.adminLowStock !== false} label="Email on low stock" onChange={(v) => void saveAlerts({ ...alerts, emails: { ...alerts.emails, adminLowStock: v } }, "emails")} /></div>
              <div className="frow"><label htmlFor="al-to">Send to</label>
                <input id="al-to" className="ain wide" style={{ flex: 1, minWidth: 180 }} type="email" disabled={!isOwner} defaultValue={String(alerts.business.alertEmail ?? "")}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v !== String(alerts.business.alertEmail ?? "")) void saveAlerts({ ...alerts, business: { ...alerts.business, alertEmail: v } }, "business"); }} />
              </div>
              <div className="impact">Each low-stock alert is sent once, by the order that crossed the level.{isOwner ? "" : " Only the Owner can change the address."}</div>
            </div>
          </section>
        )}

        <Feat k="quiz" title="Vitamin finder quiz" desc="Five questions that end in a suggested set." on={F.quiz.on} onToggle={(on) => set("quiz", { on })}>
          <Num id="qz-d" label="Discount on the suggested set (%)" value={F.quiz.discount} max={40} onChange={(discount) => set("quiz", { discount })} />
          <div className="frow"><span>Questions and suggestions</span><Link className="btn ghost sm" href="/admin/quiz">Edit quiz</Link></div>
        </Feat>

        <Feat k="freebie" title="Free guide for emails" desc="A free download offered for an email address, with consent. Shown on the homepage and, if you like, in a pop-up." on={F.freebie.on} onToggle={(on) => set("freebie", { on })}
          impact={<><b>{guide?.total ?? 0}</b> sign-ups from the guide ({guide?.week ?? 0} in the last 7 days). Each is saved with consent and tagged &ldquo;free guide&rdquo;. Never shown at checkout; &ldquo;No thanks&rdquo; waits {F.freebie.remindDays} days.</>}>
          <div className="frow"><label htmlFor="fb-t">Title</label><input id="fb-t" className="ain wide" style={{ flex: 1 }} maxLength={90} value={F.freebie.title} onChange={(e) => set("freebie", { title: e.target.value })} /></div>
          <div className="frow"><label htmlFor="fb-x">Text</label><textarea id="fb-x" className="ain wide" style={{ flex: 1 }} maxLength={300} value={F.freebie.text} onChange={(e) => set("freebie", { text: e.target.value })} /></div>
          <div className="frow"><label htmlFor="fb-b">Button</label><input id="fb-b" className="ain wide" style={{ flex: 1 }} maxLength={40} value={F.freebie.button} onChange={(e) => set("freebie", { button: e.target.value })} /></div>
          <div className="frow"><span>Also offer it in a pop-up</span><Switch on={F.freebie.popup} label="Pop-up" onChange={(popup) => set("freebie", { popup })} /></div>
          <Num id="fb-d" label="Pop-up after (seconds)" value={F.freebie.delaySec} min={5} max={300} disabled={!F.freebie.popup} onChange={(delaySec) => set("freebie", { delaySec })} />
          <Num id="fb-r" label="After “No thanks”, ask again after (days)" value={F.freebie.remindDays} min={1} max={365} disabled={!F.freebie.popup} onChange={(remindDays) => set("freebie", { remindDays })} />
          <div className="frow"><span>Show sooner when a desktop visitor moves to leave</span><Switch on={F.freebie.exitIntent} disabled={!F.freebie.popup} label="Exit intent" onChange={(exitIntent) => set("freebie", { exitIntent })} /></div>
          <div className="frow"><span>Give the welcome code too{F.welcome.on ? ` (${F.welcome.code})` : " (welcome offer is off)"}</span><Switch on={F.freebie.giveCode} label="Welcome code" onChange={(giveCode) => set("freebie", { giveCode })} /></div>
          <div className="frow"><label htmlFor="fb-f">Guide file</label><input id="fb-f" className="ain wide" style={{ flex: 1 }} value={F.freebie.fileUrl} onChange={(e) => set("freebie", { fileUrl: e.target.value.trim() })} /></div>
          <div className="frow"><span>The guide</span><a className="btn ghost sm" href={F.freebie.fileUrl} target="_blank" rel="noopener">Open the PDF</a></div>
        </Feat>

        <Feat k="freeDelivery" title="Free delivery bar" desc="Shows how close the basket is to free delivery." on={F.freeDelivery.on} onToggle={(on) => set("freeDelivery", { on })}
          impact={g?.avgOrder != null ? <>Average order is <b>{gbp(g.avgOrder)}</b> ({g.orders7} orders, 7 days). A threshold a little above it encourages one more item.</> : "No paid orders in the last 7 days yet."}>
          <Num id="fd-t" label="Free delivery from (£)" value={F.freeDelivery.threshold} max={500} onChange={(threshold) => set("freeDelivery", { threshold })} />
        </Feat>

        <Feat k="announcement" title="Announcement bar" desc="The rotating line at the top of every page." on={F.announcement.on} onToggle={(on) => set("announcement", { on })}>
          {messages.map((m, i) => (
            <div className="frow" key={i}>
              <input className="ain wide" style={{ flex: 1, minWidth: 0 }} aria-label={`Message ${i + 1}`} maxLength={90} value={m}
                onChange={(e) => set("announcement", { messages: messages.map((x, j) => (j === i ? e.target.value : x)) })} />
              <button type="button" className="btn ghost sm" onClick={() => set("announcement", { messages: messages.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          ))}
          <div><button type="button" className="btn ghost sm" disabled={messages.length >= 6} onClick={() => set("announcement", { messages: [...messages, "New message"] })}>Add a message</button></div>
        </Feat>

        <Feat k="welcome" title="Welcome offer" desc="Money off a first order, given after a newsletter or free guide sign-up." on={F.welcome.on} onToggle={(on) => set("welcome", { on })}
          impact="Shown once per visitor, never on checkout.">
          <Num id="wl-p" label="Discount (%)" value={F.welcome.pct} max={50} onChange={(pct) => set("welcome", { pct })} />
          <div className="frow"><span>Code</span><b>{F.welcome.code}</b></div>
        </Feat>

        <Feat k="bundles" title="Bundles" desc="Product sets sold together at a lower price." on={F.bundles.on} onToggle={(on) => set("bundles", { on })}>
          <div className="frow"><span>{g ? `${g.bundles.live} of ${g.bundles.total} bundles live` : "Bundles"}</span><Link className="btn ghost sm" href="/admin/offers">Manage bundles</Link></div>
        </Feat>

        <Feat k="codes" title="Discount codes" desc="Codes customers type in the basket." on={F.codes.on} onToggle={(on) => set("codes", { on })}>
          <div className="frow"><span>{g ? `${g.codesLive} active code${g.codesLive === 1 ? "" : "s"}` : "Codes"}</span><Link className="btn ghost sm" href="/admin/offers">Manage codes</Link></div>
        </Feat>

        <Feat k="crossSell" title="Cross-sell suggestions" desc="“Pairs well with” in the basket and “Often bought together” on product pages." on={F.crossSell.on} onToggle={(on) => set("crossSell", { on })} />

        <Feat k="stockUrgency" title="Low-stock messages" desc="Tells shoppers when only a few are left." on={F.stockUrgency.on} onToggle={(on) => set("stockUrgency", { on })}
          impact="Uses real stock levels only.">
          <Num id="su-u" label="Show when stock is at or below" value={F.stockUrgency.under} min={1} max={500} onChange={(under) => set("stockUrgency", { under })} />
        </Feat>

        <Feat k="reviews" title="Reviews" desc="Star ratings and the reviews section on product pages." on={F.reviews.on} onToggle={(on) => set("reviews", { on })}
          impact={<>Buyers are asked for a review by email after delivery. <Link href="/admin/reviews">Hide or show reviews</Link>.</>} />
      </div>

      <div className="kpis">
        <div className="kpi"><span>Free guide sign-ups</span><b>{guide?.total ?? 0}</b><em className="muted">{guide?.week ?? 0} in the last 7 days</em></div>
        <div className="kpi"><span>All email sign-ups</span><b>{allSignups}</b><em className="muted">with consent</em></div>
        <div className="kpi"><span>Active subscriptions</span><b>{g?.subscriptions.active ?? "–"}</b><em className="muted">{g ? `about ${gbp(g.subscriptions.perMonth)} a month` : ""}</em></div>
      </div>

      <Funnel />

      <div className="acard">
        <h2>Where paying customers came from <span className="sub">last 30 days</span></h2>
        {rep.channels.length === 0 ? <p className="muted">No paid orders with a known source yet. Sources are recorded for shoppers who accept analytics cookies.</p> : (
          <div className="tscroll"><table className="t"><thead><tr><th>Source</th><th className="r">Orders</th><th className="r">Sales</th></tr></thead>
            <tbody>{rep.channels.map((c) => <tr key={c.channel}><td>{c.channel}</td><td className="r">{c.orders}</td><td className="r">{gbp(c.sales)}</td></tr>)}</tbody></table></div>
        )}
      </div>

      <div className="acard">
        <h2>What people searched for <span className="sub">last 30 days</span></h2>
        {rep.searches.length === 0 ? <p className="muted">No searches recorded yet.</p> : (
          <div className="tscroll"><table className="t"><thead><tr><th>Words</th><th className="r">Times</th><th>Found anything?</th></tr></thead>
            <tbody>{rep.searches.map((s) => <tr key={s.words}><td>{s.words}</td><td className="r">{s.times}</td><td>{s.no_results ? <span className="pill low">Nothing found</span> : <span className="pill active">Yes</span>}</td></tr>)}</tbody></table></div>
        )}
      </div>

      <div className="acard">
        <div className="frow"><h2>Latest sign-ups</h2><button className="btn ghost sm" disabled={!subs?.recent.length} onClick={exportCsv}>Download CSV</button></div>
        {!subs ? <p className="muted">Loading…</p> : subs.recent.length === 0 ? <p className="muted">No sign-ups yet.</p> : (
          <div className="tscroll"><table className="t">
            <thead><tr><th>Email</th><th>From</th><th>Signed up</th></tr></thead>
            <tbody>{subs.recent.map((r) => (
              <tr key={r.email}><td>{r.email}</td><td>{SOURCE[r.source] ?? r.source}</td><td>{new Date(r.consent_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}
