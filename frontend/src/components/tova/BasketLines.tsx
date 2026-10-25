"use client";

import Link from "next/link";
import { useShop } from "./ShopProvider";
import { ProductArt } from "./ProductArt";
import { freqLabel, gbp, round2 } from "../../lib/tova/shop";
import type { Cart, CartLine, CartPricing } from "../../lib/tova/types";

/** Bundle lines travel together, so they're shown (and changed) as one row. */
export type BasketRow =
  | { kind: "single"; line: CartLine }
  | { kind: "bundle"; bundleId: string; name: string; lines: CartLine[]; qty: number; total: number; full: number };

export function basketRows(cart: Cart): BasketRow[] {
  const rows: BasketRow[] = [];
  const seen = new Map<string, Extract<BasketRow, { kind: "bundle" }>>();
  for (const l of cart.items) {
    if (!l.bundleId) { rows.push({ kind: "single", line: l }); continue; }
    let b = seen.get(l.bundleId);
    if (!b) {
      b = { kind: "bundle", bundleId: l.bundleId, name: l.bundleName ?? "Bundle", lines: [], qty: l.quantity, total: 0, full: 0 };
      seen.set(l.bundleId, b); rows.push(b);
    }
    b.lines.push(l);
    b.total = round2(b.total + l.lineTotal);
    b.full = round2(b.full + l.currentPrice * l.quantity);
  }
  return rows;
}

function Problem({ l }: { l: CartLine }) {
  if (!l.isPurchasable) return <small className="formerr">No longer available. Please remove it.</small>;
  if (l.quantityExceedsStock) return <small className="formerr">Only {l.currentStock} left. Please lower the quantity.</small>;
  return null;
}

export function BasketLine({ row, compact }: { row: BasketRow; compact?: boolean }) {
  const { store, setQty, setSub, removeLine, cartBusy } = useShop();
  const f = store?.features;
  if (row.kind === "bundle") {
    const first = row.lines[0];
    return (
      <div className="line">
        <div className="im"><ProductArt slug={first.slug} name={first.productName} image={first.imageUrl} alt="" /></div>
        <div>
          <b>{row.name}</b><small>{row.lines.map((l) => l.productName).join(" + ")}</small>
          {compact ? <small>Qty {row.qty}</small> : (
            <div className="qty">
              <button disabled={cartBusy || row.qty <= 1} onClick={() => setQty(first.id, row.qty - 1)} aria-label="Fewer">−</button>
              <span className="num">{row.qty}</span>
              <button disabled={cartBusy} onClick={() => setQty(first.id, row.qty + 1)} aria-label="More">+</button>
            </div>
          )}
          {row.lines.map((l) => <Problem key={l.id} l={l} />)}
        </div>
        <div className="right num">
          <b>{gbp(row.total)}</b>{row.full > row.total && <span className="was">{gbp(row.full)}</span>}
          {!compact && <button className="rm" disabled={cartBusy} onClick={() => removeLine(first.id)}>Remove</button>}
        </div>
      </div>
    );
  }
  const l = row.line;
  return (
    <div className="line">
      <div className="im"><ProductArt slug={l.slug} name={l.productName} image={l.imageUrl} alt="" /></div>
      <div>
        <b><Link href={`/products/${l.slug}`} style={{ textDecoration: "none" }}>{l.productName}</Link></b>
        <small>{l.isSubscription && l.subscriptionMonths ? `Every ${freqLabel(l.subscriptionMonths)}` : "One-time purchase"}</small>
        {compact ? <small>Qty {l.quantity}</small> : (
          <>
            <div className="qty">
              <button disabled={cartBusy} onClick={() => (l.quantity <= 1 ? removeLine(l.id) : setQty(l.id, l.quantity - 1))} aria-label={l.quantity <= 1 ? "Remove" : "Fewer"}>−</button>
              <span className="num">{l.quantity}</span>
              <button disabled={cartBusy} onClick={() => setQty(l.id, l.quantity + 1)} aria-label="More">+</button>
            </div>
            {f?.subscribe.on && (
              <label className="subtoggle">
                <input type="checkbox" checked={!!l.subscriptionMonths} disabled={cartBusy}
                  onChange={(e) => setSub(l.id, e.target.checked ? f.subscribe.freqs[0] ?? 1 : null)} />
                Subscribe & save {f.subscribe.discount}%
              </label>
            )}
            {f?.subscribe.on && l.subscriptionMonths && f.subscribe.freqs.length > 1 && (
              <select className="select subfreq" value={l.subscriptionMonths} aria-label={`How often ${l.productName} arrives`} disabled={cartBusy}
                onChange={(e) => setSub(l.id, Number(e.target.value))}>
                {f.subscribe.freqs.map((m) => <option key={m} value={m}>Every {freqLabel(m)}</option>)}
              </select>
            )}
          </>
        )}
        <Problem l={l} />
      </div>
      <div className="right num">
        <b>{gbp(l.lineTotal)}</b>{l.isSubscription && <span className="was">{gbp(l.currentPrice * l.quantity)}</span>}
        {!compact && <button className="rm" disabled={cartBusy} onClick={() => removeLine(l.id)}>Remove</button>}
      </div>
    </div>
  );
}

const ZONE = { mainland: "UK mainland", highlands: "Highlands & Islands", ni: "Northern Ireland" } as const;

/** The money breakdown. Every figure comes from the server's pricing engine. */
export function Summary({ p, vatRate, rewardsOn, showLines }: { p: CartPricing; vatRate: number; rewardsOn: boolean; showLines?: boolean }) {
  return (
    <div className="sum num">
      {showLines !== false && <div><span>Items</span><span>{gbp(p.full)}</span></div>}
      {p.discounts.map((d) => <div className="save" key={d.type + d.label}><span>{d.label}</span><span>−{gbp(d.amount)}</span></div>)}
      <div><span>Delivery{p.deliveryIsEstimate ? "" : `, ${ZONE[p.deliveryZone]}`}</span><span>{p.delivery === 0 ? "Free" : gbp(p.delivery)}</span></div>
      <div className="tot"><span>Total</span><span>{gbp(p.total)}</span></div>
      {p.saved > 0 && <div className="save"><span>You&apos;re saving</span><span>{gbp(p.saved)}</span></div>}
      {rewardsOn && <div style={{ color: "var(--gold-ink)", fontWeight: 600 }}><span>Points you&apos;ll earn</span><span>{p.pointsEarned}</span></div>}
      <div style={{ color: "var(--ink-3)", fontSize: 13 }}><span>Includes VAT at {vatRate}%</span><span>{gbp(p.vat)}</span></div>
    </div>
  );
}
