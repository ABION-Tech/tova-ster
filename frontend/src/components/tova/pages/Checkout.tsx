"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useShop } from "../ShopProvider";
import { BasketLine, Summary, basketRows } from "../BasketLines";
import { Loading } from "../Loading";
import { api, cartApi, orderApi } from "../../../lib/tova/api";
import { memory } from "../../../lib/tova/memory";
import { gbp } from "../../../lib/tova/shop";
import { PayMarks } from "../PayMarks";

interface Draft { email: string; first: string; last: string; phone: string; line1: string; line2: string; city: string; postcode: string; note: string }
const EMPTY: Draft = { email: "", first: "", last: "", phone: "", line1: "", line2: "", city: "", postcode: "", note: "" };

function cleanSource(s: object | null): Record<string, string> | undefined {
  if (!s) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(s)) if (typeof v === "string" && v) out[k] = v.slice(0, 200);
  return Object.keys(out).length ? out : undefined;
}

export function Checkout({ cancelled }: { cancelled: boolean }) {
  const { store, cart, user, rememberPostcode, refreshCart, track } = useShop();
  const [d, setD] = useState<Draft>(EMPTY);
  const [pcErr, setPcErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Remembered details: this browser's last checkout, then the account's saved address.
  useEffect(() => {
    const saved = memory.get<Draft>("checkout");
    if (saved) setD({ ...EMPTY, ...saved, note: "" });
    track("checkout", "Opened checkout");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!user) return;
    setD((x) => ({ ...x, email: x.email || user.email, first: x.first || user.firstName, last: x.last || user.lastName, phone: x.phone || user.phone || "" }));
    api<{ addresses: { full_name: string; phone: string; line1: string; line2: string | null; city: string; postal_code: string; is_default: boolean }[] }>("/addresses")
      .then(({ addresses }) => {
        const a = addresses.find((x) => x.is_default) ?? addresses[0];
        if (a) setD((x) => (x.line1 ? x : { ...x, line1: a.line1, line2: a.line2 ?? "", city: a.city, postcode: a.postal_code, phone: x.phone || a.phone }));
      }).catch(() => {});
  }, [user]);
  useEffect(() => { if (cart?.postcode && !d.postcode) setD((x) => ({ ...x, postcode: cart.postcode! })); }, [cart?.postcode]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!store || !cart) return <Loading />;
  const f = store.features;
  const rows = basketRows(cart);
  if (!rows.length) return (
    <main className="wrap"><div className="empty" style={{ marginTop: 40 }}><b>Your basket is empty</b><Link className="btn sm" href="/shop">Shop the range</Link></div></main>
  );

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = { ...d, [k]: e.target.value };
    setD(next);
    const { note: _n, ...keep } = next;
    memory.set("checkout", keep); // remembered on this device for next time
  };

  async function checkPostcode() {
    if (!d.postcode.trim()) return;
    setPcErr(await rememberPostcode(d.postcode));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      if (pcErr) throw new Error(pcErr);
      cartApi.remember({ email: d.email }).catch(() => {});
      const name = `${d.first.trim()} ${d.last.trim()}`;
      const { order } = await orderApi.place({
        customer: { name, email: d.email.trim(), phone: d.phone.trim() },
        delivery: { recipientName: name, phone: d.phone.trim(), line1: d.line1.trim(), line2: d.line2.trim() || undefined, city: d.city.trim(), postalCode: d.postcode.trim(), instructions: d.note.trim() || undefined },
        // Where this shopper first came from, only if they accepted analytics cookies.
        source: memory.consent() === "all" ? cleanSource(memory.source()) : undefined,
      });
      const { checkoutUrl } = await orderApi.pay(order.id);
      track("checkout", `Went to payment for ${order.orderNumber}`, { orderNumber: order.orderNumber });
      window.location.assign(checkoutUrl);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Something went wrong. Please try again.");
      setBusy(false);
      refreshCart();
    }
  }

  const p = cart.pricing;
  const methods = [f.payments.card && "card", f.payments.applePay && "Apple Pay", f.payments.googlePay && "Google Pay", f.payments.paypal && "PayPal", f.payments.klarna && "Klarna"].filter(Boolean) as string[];
  return (
    <main className="wrap"><h1 className="page-title">Checkout</h1>
      {cancelled && <div className="notice gold" style={{ marginBottom: 16 }}>Payment wasn&apos;t completed, so you haven&apos;t been charged. Your basket is still here.</div>}
      <div className="co">
        <form className={`panel${busy ? " busy" : ""}`} onSubmit={submit} style={{ gap: 18 }}>
          <h2>Your details</h2>
          <div className="fields">
            <div className="field full"><label htmlFor="ce">Email</label><input id="ce" type="email" required autoComplete="email" value={d.email} onChange={set("email")} placeholder="you@example.com" /></div>
            <div className="field"><label htmlFor="cf">First name</label><input id="cf" required autoComplete="given-name" value={d.first} onChange={set("first")} /></div>
            <div className="field"><label htmlFor="cl">Last name</label><input id="cl" required autoComplete="family-name" value={d.last} onChange={set("last")} /></div>
            <div className="field full"><label htmlFor="cph">Mobile number, for delivery updates</label><input id="cph" type="tel" required autoComplete="tel" value={d.phone} onChange={set("phone")} placeholder="07700 900123" /></div>
          </div>
          <h2>Delivery</h2>
          <div className="fields">
            <div className="field full"><label htmlFor="ca">Address</label><input id="ca" required autoComplete="address-line1" value={d.line1} onChange={set("line1")} /></div>
            <div className="field full"><label htmlFor="ca2">Flat, building (optional)</label><input id="ca2" autoComplete="address-line2" value={d.line2} onChange={set("line2")} /></div>
            <div className="field"><label htmlFor="ct">Town or city</label><input id="ct" required autoComplete="address-level2" value={d.city} onChange={set("city")} /></div>
            <div className="field"><label htmlFor="cp">Postcode</label><input id="cp" required autoComplete="postal-code" value={d.postcode} onChange={set("postcode")} onBlur={checkPostcode} placeholder="e.g. SE15 5BY" style={{ textTransform: "uppercase" }} /></div>
            <div className="field full"><label htmlFor="cn">Delivery note (optional)</label><input id="cn" value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} placeholder="e.g. leave with neighbour at no. 12" maxLength={200} /></div>
          </div>
          {pcErr ? <div className="notice warn">{pcErr}</div> : (
            <div className={`notice ${p.delivery === 0 ? "good" : "gold"}`}>
              {p.deliveryIsEstimate ? "Delivery, UK mainland (enter your postcode to confirm)" : { mainland: "UK mainland", highlands: "Highlands & Islands", ni: "Northern Ireland" }[p.deliveryZone]}: {p.delivery === 0 ? "free delivery" : gbp(p.delivery)}
            </div>
          )}
          <h2>Payment</h2>
          <PayMarks payments={f.payments} label="You can pay with" />
          <p style={{ fontSize: 13, color: "var(--ink-3)" }}>You&apos;ll pay on Stripe&apos;s secure page, where you can choose {methods.join(", ").replace("card", "card")}. Your order is only confirmed once Stripe tells us the payment went through.</p>
          {err && <div className="notice warn" role="alert">{err}</div>}
          <button className="btn block" type="submit" disabled={busy || cart.hasBlockingIssues}>{busy ? "Taking you to payment…" : `Pay ${gbp(p.total)}`}</button>
          <p style={{ fontSize: 13, color: "var(--ink-3)" }}>We save these details on this device so checkout is quicker next time.</p>
        </form>
        <div className="panel" style={{ background: "var(--surface)", border: 0 }}>
          <h2>Order summary</h2>
          <div style={{ display: "grid", gap: 12 }}>{rows.map((r) => <BasketLine key={r.kind === "single" ? r.line.id : r.bundleId} row={r} compact />)}</div>
          <Summary p={p} vatRate={store.delivery.vat} rewardsOn={f.rewards.on && !!user} />
          {f.rewards.on && !user && <p style={{ fontSize: 13 }}><Link href="/account?next=/checkout">Sign in or join</Link> to earn {p.pointsEarned} points on this order.</p>}
        </div>
      </div>
    </main>
  );
}
