"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { adminJson } from "../../../lib/backend";

/**
 * Delivery prices by area, what each area is called in the shop, the
 * same-day cut-off and the courier used for each area. Prices are money, so
 * this page saves on a button press rather than on its own.
 */

type Zone = "mainland" | "highlands" | "ni";
interface Delivery { mainland: number; highlands: number; ni: number; cutoffHour: number; vat: number; labels: Record<Zone, string>; note: string }
interface Dispatch { carriers: Record<Zone, string>; [k: string]: unknown }
const ZONES: { key: Zone; hint: string }[] = [
  { key: "mainland", hint: "England, Wales and most of Scotland" },
  { key: "highlands", hint: "Scottish Highlands and islands, Isles of Scilly" },
  { key: "ni", hint: "Postcodes starting BT" },
];

export default function DeliveryAdmin() {
  const [d, setD] = useState<Delivery | null>(null);
  const [dispatch, setDispatch] = useState<Dispatch | null>(null);
  const [freeOn, setFreeOn] = useState<{ on: boolean; threshold: number } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    adminJson<{ settings: { delivery: Delivery; dispatch: Dispatch; features: { freeDelivery: { on: boolean; threshold: number } } } }>("/admin/settings")
      .then((r) => { setD(r.settings.delivery); setDispatch(r.settings.dispatch); setFreeOn(r.settings.features.freeDelivery); })
      .catch((e) => setMsg({ ok: false, text: e.message }));
  }, []);

  if (!d || !dispatch) return <p className="muted">{msg?.text ?? "Loading…"}</p>;

  const change = (patch: Partial<Delivery>) => { setD({ ...d, ...patch }); setDirty(true); setMsg(null); };
  const price = (z: Zone, v: string) => { const n = Number(v); change({ [z]: v === "" || !Number.isFinite(n) ? 0 : Math.round(n * 100) / 100 } as Partial<Delivery>); };

  async function save() {
    if (!d || !dispatch) return;
    for (const z of ZONES) if (!(d[z.key] >= 0) || d[z.key] > 100) { setMsg({ ok: false, text: "Delivery prices must be between £0 and £100." }); return; }
    if (ZONES.some((z) => !d.labels[z.key].trim())) { setMsg({ ok: false, text: "Give every delivery area a name." }); return; }
    setBusy(true); setMsg(null);
    try {
      await adminJson("/admin/settings/delivery", { method: "PUT", body: JSON.stringify({ value: d }) });
      await adminJson("/admin/settings/dispatch", { method: "PUT", body: JSON.stringify({ value: dispatch }) });
      setDirty(false);
      setMsg({ ok: true, text: "Saved. New baskets use these prices straight away; the shop's wording updates within a minute." });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't save." }); } finally { setBusy(false); }
  }

  const hours = Array.from({ length: 13 }, (_, i) => i + 8);
  const hourText = (h: number) => (h === 12 ? "12 noon" : h < 12 ? `${h}am` : `${h - 12}pm`);

  return (
    <>
      <div className="ahead">
        <div><h1>Delivery</h1><p>What delivery costs in each part of the UK, and how the shop describes it.</p></div>
        <button className="btn sm" disabled={busy || !dirty} onClick={save}>{busy ? "Saving…" : dirty ? "Save changes" : "Saved"}</button>
      </div>
      {msg && <div className={`notice ${msg.ok ? "good" : "warn"}`} role="status">{msg.text}</div>}

      {freeOn && (
        <div className={`notice ${freeOn.on ? "warn" : "gold"}`}>
          <span>{freeOn.on
            ? <>Free delivery is <b>on</b> for baskets over £{freeOn.threshold}. You pay the postage on those orders.&nbsp;<Link href="/admin/growth">Change it in Growth tools</Link></>
            : <>Free delivery is <b>off</b>. Every order pays the price below. You can switch it on in <Link href="/admin/growth">Growth tools</Link> if you ever want to.</>}</span>
        </div>
      )}

      <div className="acard">
        <h2>Prices by area</h2>
        <p className="sub">Prices include VAT. The area is worked out from the customer&apos;s postcode at checkout. Rename an area to change how it reads in the basket, checkout, product pages and Help page.</p>
        <div className="tscroll">
          <table className="t zones">
            <thead><tr><th>Area name in the shop</th><th>Covers</th><th className="r">Price (£)</th><th>Courier</th></tr></thead>
            <tbody>
              {ZONES.map((z) => (
                <tr key={z.key}>
                  <td><input className="ain wide" aria-label={`Name for ${z.hint}`} maxLength={40} value={d.labels[z.key]} onChange={(e) => change({ labels: { ...d.labels, [z.key]: e.target.value } })} /></td>
                  <td className="muted">{z.hint}</td>
                  <td className="r"><input className="ain" type="number" min={0} max={100} step={0.01} inputMode="decimal" aria-label={`Price for ${d.labels[z.key]}`} value={d[z.key]} onChange={(e) => price(z.key, e.target.value)} /></td>
                  <td><input className="ain wide" aria-label={`Courier for ${d.labels[z.key]}`} maxLength={60} value={dispatch.carriers[z.key] ?? ""} onChange={(e) => { setDispatch({ ...dispatch, carriers: { ...dispatch.carriers, [z.key]: e.target.value } }); setDirty(true); }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">The Channel Islands and the Isle of Man can&apos;t order yet.</p>
      </div>

      <div className="acard">
        <h2>Sending times</h2>
        <div className="frow">
          <label htmlFor="cut">Same-day dispatch cut-off</label>
          <select id="cut" className="ain" style={{ width: 140 }} value={d.cutoffHour} onChange={(e) => change({ cutoffHour: Number(e.target.value) })}>
            {hours.map((h) => <option key={h} value={h}>{hourText(h)}</option>)}
          </select>
        </div>
        <label className="fld">Line shown with the prices (product pages)
          <input maxLength={160} value={d.note ?? ""} onChange={(e) => change({ note: e.target.value })} placeholder="e.g. Order before the cut-off on a working day and we send it the same day." />
        </label>
        <p className="muted">The homepage and Help page say &ldquo;Order by {hourText(d.cutoffHour)}&rdquo; and use this time.</p>
      </div>
    </>
  );
}
