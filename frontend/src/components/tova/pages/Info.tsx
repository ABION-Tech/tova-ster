"use client";

import Link from "next/link";
import { useShop } from "../ShopProvider";
import { BundleCard } from "../BundleCard";
import { Loading } from "../Loading";
import { gbp, gbpShort, hourLabel, multibuyTitle } from "../../../lib/tova/shop";

export function Offers() {
  const { store } = useShop();
  if (!store) return <Loading />;
  const f = store.features;
  return (
    <main className="wrap"><h1 className="page-title">Offers</h1>
      {f.multibuy.on && (
        <div className="band quizband" style={{ marginBottom: 24 }}>
          <div><h2>{multibuyTitle(f.multibuy.mode)}</h2><p>Mix and match across the range. The saving is taken off in your basket automatically.</p><div className="actions"><Link className="btn" href="/shop">Shop the range</Link></div></div>
          <div className="qpreview"><b>How it works</b><div className="opt on">Add any {f.multibuy.mode === "2save10" ? "two" : "three"} products</div><div className="opt on">The saving shows in your basket</div><div className="opt">Subscriptions and bundles have their own saving</div></div>
        </div>
      )}
      {f.bundles.on && store.bundles.length > 0 && <><div className="sec-head"><div><h2>Bundles</h2></div></div><div className="bundles">{store.bundles.map((b) => <BundleCard key={b.id} b={b} />)}</div></>}
      {f.welcome.on && <div className="notice gold" style={{ marginTop: 24 }}>New here? Sign up to our emails on the homepage for {f.welcome.pct}% off your first order.</div>}
      {!f.multibuy.on && !(f.bundles.on && store.bundles.length) && <div className="empty"><b>No offers running right now</b><p>Sign up to our emails to hear about the next one.</p></div>}
      <div style={{ height: 48 }} />
    </main>
  );
}

export function Help() {
  const { store } = useShop();
  if (!store) return <Loading />;
  const f = store.features, d = store.delivery, b = store.business;
  return (
    <main className="wrap" style={{ maxWidth: 800 }}><h1 className="page-title">Help</h1>
      <div style={{ display: "grid", gap: 4, marginBottom: 48 }}>
        <details className="acc" id="delivery" open><summary>Delivery</summary><div className="in"><p>UK mainland {gbp(d.mainland)}{f.freeDelivery.on ? `, free over ${gbpShort(f.freeDelivery.threshold)}` : ""}. Highlands & Islands {gbp(d.highlands)}. Northern Ireland {gbp(d.ni)}. Order before {hourLabel(d.cutoffHour)} on a working day and we send it the same day. We don&apos;t deliver to the Channel Islands or the Isle of Man yet.</p></div></details>
        <details className="acc" id="returns"><summary>Returns</summary><div className="in"><p>Unopened pots can be returned within 30 days for a full refund. Email {b.email} with your order number and we&apos;ll send you a returns label.</p></div></details>
        {f.subscribe.on && <details className="acc" id="subscriptions"><summary>Subscriptions</summary><div className="in"><p>Save {f.subscribe.discount}% on every delivery. Skip, pause or cancel any time from your account. We email you a reminder before each delivery.</p></div></details>}
        {f.rewards.on && <details className="acc" id="points"><summary>Reward points</summary><div className="in"><p>Earn {f.rewards.earn} points for every £1. 100 points take {gbp(f.rewards.pointValue)} off. Spend from {f.rewards.minRedeem} points. You get {f.rewards.signup} points when you create an account.</p></div></details>}
        <details className="acc" id="quality"><summary>Quality & safety</summary><div className="in"><p>Everything we say about our products on this website uses only health claims authorised for use in Great Britain. Food supplements should not be used as a substitute for a varied, balanced diet and a healthy lifestyle. If you are pregnant, breastfeeding or taking medication, speak to your GP or pharmacist first.</p></div></details>
        <details className="acc" id="privacy"><summary>Privacy & cookies</summary><div className="in"><p>We use essential cookies to run the shop: your basket, your sign-in and your cookie choice. This browser also remembers your recently viewed products, quiz answers and checkout details so the shop is quicker next time; you can clear them by clearing this site&apos;s data. Analytics cookies are only used if you accept them. To see, download or delete the data we hold about you, email {b.email}.</p></div></details>
        <details className="acc" id="terms"><summary>Terms</summary><div className="in"><p>{b.name}. {b.company}. Registered address: {b.address}. Full terms of sale are sent with your order confirmation.</p></div></details>
        <details className="acc" id="contact"><summary>Contact us</summary><div className="in"><p>Email <a href={`mailto:${b.email}`}><b>{b.email}</b></a>. We reply within one working day.</p></div></details>
      </div>
    </main>
  );
}
