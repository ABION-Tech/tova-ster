import { freqLabel, gbp } from "../../lib/tova/shop";
import type { Receipt } from "../../lib/tova/types";

const ORDER = ["held", "paid", "label", "packed", "dispatched", "delivered"];

export function Tracking({ r }: { r: Receipt }) {
  if (r.stage === "cancelled" || r.stage === "awaiting_payment") return null;
  const at = ORDER.indexOf(r.stage);
  const steps: [string, string][] = [["paid", "Order placed"], ["packed", "Packed"], ["dispatched", "On its way"], ["delivered", "Delivered"]];
  return (
    <div className="track">
      <div className="tsteps">{steps.map(([k, l]) => <div key={k} className={`tstep ${ORDER.indexOf(k) <= at || (k === "paid" && at >= 0) ? "done" : ""}`}><span />{l}</div>)}</div>
      {r.trackingNumber && at >= 4 && <p className="rsmall">{r.carrier} tracking number <b className="num">{r.trackingNumber}</b></p>}
    </div>
  );
}

/** The VAT receipt. Every figure is what was stored when the order was placed. */
export function ReceiptView({ r, vatRate = 20 }: { r: Receipt; vatRate?: number }) {
  const b = r.business;
  const refunded = r.status === "REFUNDED";
  const date = new Date(r.paidAt ?? r.placedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return (
    <article className="receipt" aria-label={`Receipt ${r.receiptNumber}`}>
      <div className="rhead">
        <div className="cellflex">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/monogram.png" alt="" style={{ width: 34, height: 45, objectFit: "contain" }} />
          <div><b style={{ fontFamily: "var(--display)", fontSize: 22, letterSpacing: ".02em" }}>TOVA-STER</b><div className="rsmall">{b.web}</div></div>
        </div>
        <div style={{ textAlign: "right" }}><b>{refunded ? "Credit note" : b.vatRegistered ? "VAT receipt" : "Receipt"}</b><div className="rsmall">{r.receiptNumber}</div></div>
      </div>
      <div className="rgrid">
        <div><div className="rsmall">Order</div><b>{r.orderNumber}</b></div>
        <div><div className="rsmall">Date</div><b>{date}</b></div>
        <div><div className="rsmall">Paid with</div><b>{r.paymentMethod ?? "Card (Stripe)"}</b></div>
        <div><div className="rsmall">Deliver to</div><b>{r.address?.name ?? r.customer.name}</b>{r.address && <div className="rsmall">{[r.address.line1, r.address.line2, r.address.city, r.address.postcode].filter(Boolean).join(", ")}</div>}</div>
      </div>
      <table className="rt">
        <thead><tr><th>Item</th><th className="r">Qty</th><th className="r">Price</th><th className="r">Total</th></tr></thead>
        <tbody>{r.items.map((i, k) => (
          <tr key={k}>
            <td>{i.name}
              {i.subscriptionMonths && <div className="rsmall">Subscription, every {freqLabel(i.subscriptionMonths)}</div>}
              {i.bundleName && <div className="rsmall">{i.bundleName}</div>}
            </td>
            <td className="r num">{i.quantity}</td><td className="r num">{gbp(i.fullUnitPrice)}</td><td className="r num">{gbp(i.fullUnitPrice * i.quantity)}</td>
          </tr>
        ))}</tbody>
      </table>
      <div className="sum num rsum">
        <div><span>Items</span><span>{gbp(r.subtotal)}</span></div>
        {r.discounts.map((d) => <div className="save" key={d.type + d.label}><span>{d.label}</span><span>−{gbp(d.amount)}</span></div>)}
        <div><span>Delivery{r.carrier ? `, ${r.carrier}` : ""}</span><span>{r.delivery ? gbp(r.delivery) : "Free"}</span></div>
        <div className="tot"><span>Total paid</span><span>{gbp(r.total)}</span></div>
        {b.vatRegistered && <div style={{ color: "var(--ink-2)" }}><span>Includes VAT at {vatRate}%</span><span>{gbp(r.vat)}</span></div>}
        {refunded && <div className="save" style={{ color: "var(--sale)" }}><span>Refunded</span><span>−{gbp(r.total)}</span></div>}
        {r.pointsEarned > 0 && <div style={{ color: "var(--gold-ink)" }}><span>Points earned</span><span>{r.pointsEarned}</span></div>}
      </div>
      <div className="rfoot"><p>{b.footer}</p><p className="rsmall">{b.name}, {b.address}. {b.company}.{b.vatRegistered ? ` ${b.vatNo}.` : ""} {b.email}</p></div>
    </article>
  );
}
