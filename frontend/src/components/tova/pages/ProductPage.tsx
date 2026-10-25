"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useShop } from "../ShopProvider";
import { ProductCard } from "../ProductCard";
import { ProductArt } from "../ProductArt";
import { Icon } from "../Icons";
import { Loading } from "../Loading";
import { cutoffText, freqLabel, gbp, gbpShort, needOf, round2, shopHref, stockState, subPrice } from "../../../lib/tova/shop";

function Cutoff({ hour }: { hour: number }) {
  // Rendered after mount (clock-dependent) and refreshed each minute.
  const [t, setT] = useState<ReturnType<typeof cutoffText> | null>(null);
  useEffect(() => { setT(cutoffText(hour)); const i = setInterval(() => setT(cutoffText(hour)), 60_000); return () => clearInterval(i); }, [hour]);
  if (!t) return <span className="cutoff">&nbsp;</span>;
  return <span className="cutoff">{t.lead}<b>{t.bold}</b>{t.tail}</span>;
}

export function ProductPage({ slug }: { slug: string }) {
  const { store, bySlug, live, addItem, cartBusy, viewed, recent, track } = useShop();
  const p = bySlug.get(slug);
  const f = store?.features;
  const [view, setView] = useState(0);
  const [mode, setMode] = useState<"sub" | "once">("once");
  const [freq, setFreq] = useState(1);
  const [qty, setQty] = useState(1);

  useEffect(() => {
    if (!p) return;
    viewed(p.slug);
    track("view", `Viewed ${p.name}`, { slug: p.slug });
    setView(0); setQty(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?.slug]);
  useEffect(() => { if (f) { setMode(f.subscribe.on ? "sub" : "once"); setFreq(f.subscribe.freqs[0] ?? 1); } }, [f?.subscribe.on]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!store || !f) return <Loading />;
  if (!p) return (
    <main className="wrap"><div className="empty" style={{ marginTop: 40 }}><b>We couldn&apos;t find that product</b><p>It may have been removed from the shop.</p><Link className="btn sm" href="/shop">Shop all products</Link></div></main>
  );

  const s = stockState(p);
  const nd = needOf(p);
  const sub = f.subscribe.on && mode === "sub";
  const unit = sub ? subPrice(p, f) : p.price;

  const views: { label: string; thumb: ReactNode; main: ReactNode }[] = [
    ...(p.images.length ? p.images : [null]).map((img, i) => {
      const art = <ProductArt slug={p.slug} name={p.name} image={img?.url} alt={i ? "" : `Tova-Ster ${p.name}`} />;
      return { label: `Photo ${i + 1}`, thumb: art, main: art };
    }),
    ...(p.video_url ? [{
      label: "Video",
      thumb: <span style={{ display: "grid", placeItems: "center", height: "100%", fontSize: 12, fontWeight: 700, background: "var(--black)", color: "#fff" }}>▶ Video</span>,
      main: <video src={p.video_url} controls playsInline preload="metadata" aria-label={`${p.name} video`} />,
    }] : []),
    {
      label: "What's in it",
      thumb: <span style={{ display: "grid", placeItems: "center", height: "100%", fontSize: 12, fontWeight: 700, background: nd.color, color: nd.ink }}>Facts</span>,
      main: (
        <div className="facts-tile" style={{ background: nd.color, color: nd.ink }}>
          <h3>What&apos;s in it</h3>
          <table><tbody>{p.facts.map(([a, b]) => <tr key={a}><td>{a}</td><td>{b}</td></tr>)}</tbody></table>
          <p style={{ fontSize: 14 }}>Per daily serving.</p>
        </div>
      ),
    },
  ];
  const current = views[Math.min(view, views.length - 1)];

  const pairs = f.crossSell.on
    ? [...new Set([
        ...live.filter((x) => x.id !== p.id && x.inStock && x.needs.some((n) => p.needs.includes(n))).slice(0, 1),
        ...live.filter((x) => x.slug === "vitamin-d3-4000iu" && x.id !== p.id && x.inStock),
        ...live.filter((x) => x.id !== p.id && x.inStock && x.badge === "Best seller"),
      ])].slice(0, 2)
    : [];
  const fbtTotal = round2(p.price + pairs.reduce((a, x) => a + x.price, 0));
  const also = [
    ...recent.map((r) => bySlug.get(r)).filter((x): x is NonNullable<typeof x> => !!x && x.id !== p.id),
    ...live.filter((x) => x.id !== p.id),
  ].filter((x, i, a) => a.indexOf(x) === i).slice(0, 4);

  async function addPairs() {
    for (const x of [p!, ...pairs]) if (!(await addItem(x))) return;
  }

  const buy = () => addItem(p, qty, sub ? freq : null);

  return (
    <main className="wrap">
      <nav className="crumbs" aria-label="Breadcrumb"><Link href="/">Home</Link><span>/</span><Link href={shopHref(nd.id ? { need: nd.id } : {})}>{nd.name}</Link><span>/</span><span>{p.name}</span></nav>
      <div className="pdp">
        <div className="gallery">
          <div className="thumbs">{views.map((v, i) => <button key={i} aria-pressed={view === i} aria-label={v.label} onClick={() => setView(i)}>{v.thumb}</button>)}</div>
          <div className="mainimg">{current.main}</div>
        </div>
        <div className="buy">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {p.badge && <span className={`tag ${p.badge === "New" ? "dark" : "gold"}`}>{p.badge}</span>}
            {f.multibuy.on && f.multibuy.mode === "3for2" && <span className="tag sale">3 for 2</span>}
          </div>
          <h1>{p.name}</h1>
          {p.short_description && <p className="lead">{p.short_description}.</p>}
          {f.reviews.on && (
            <a className="stars" href="#reviews">
              {p.rating ? <><i>{"★★★★★".slice(0, Math.round(p.rating))}{"☆☆☆☆☆".slice(Math.round(p.rating))}</i> {p.rating} from {p.review_count} review{p.review_count === 1 ? "" : "s"}</> : <><i>☆☆☆☆☆</i> No reviews yet</>}
            </a>
          )}
          <ul className="benefits">{p.benefits.filter(Boolean).map((b) => <li key={b}><Icon.check /><span>{b}</span></li>)}</ul>
          <div className="opts" role="radiogroup" aria-label="Purchase options">
            {f.subscribe.on && (
              <label className="opt">
                <input type="radio" name="mode" value="sub" checked={mode === "sub"} onChange={() => setMode("sub")} />
                <span className="t">Subscribe & save {f.subscribe.discount}%</span>
                <span className="p num">{gbp(subPrice(p, f))} <span className="was">{gbp(p.price)}</span></span>
                <span className="s">Delivered every{" "}
                  <select className="select" value={freq} aria-label="Delivery frequency" onChange={(e) => { setFreq(Number(e.target.value)); setMode("sub"); }}>
                    {f.subscribe.freqs.map((m) => <option key={m} value={m}>{freqLabel(m)}</option>)}
                  </select> Skip or cancel any time.</span>
              </label>
            )}
            <label className="opt">
              <input type="radio" name="mode" value="once" checked={mode === "once"} onChange={() => setMode("once")} />
              <span className="t">One-time purchase</span><span className="p num">{gbp(p.price)}</span>
              <span className="s">{gbp(p.price / Math.max(1, p.servings))} a day{f.multibuy.on && f.multibuy.mode === "3for2" ? ". Counts towards 3 for 2." : ""}</span>
            </label>
          </div>
          {s === "low" && <div className="notice warn">Only {p.onlyLeft} left in stock</div>}
          <div className="buyrow">
            <div className="qty">
              <button onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Fewer">−</button>
              <span className="num" aria-live="polite">{qty}</span>
              <button onClick={() => setQty(Math.min(20, qty + 1))} aria-label="More">+</button>
            </div>
            <button className="btn" disabled={s === "out" || cartBusy} onClick={buy}>{s === "out" ? "Out of stock" : `Add to basket, ${gbp(unit * qty)}`}</button>
          </div>
          <div className="assure">
            <div><Icon.truck /><Cutoff hour={store.delivery.cutoffHour} /></div>
            {f.rewards.on && <div><Icon.star /><span>Earn <b>{Math.floor(unit * qty) * f.rewards.earn} points</b> with this order</span></div>}
            <div><Icon.lock /><span>Secure checkout with Stripe{f.payments.applePay ? ", Apple Pay" : ""}{f.payments.paypal ? " and PayPal" : ""}</span></div>
          </div>
          <div>
            {p.how_to_take && <details className="acc" open><summary>How to take</summary><div className="in"><p>{p.how_to_take}</p></div></details>}
            {p.ingredients && <details className="acc"><summary>Ingredients</summary><div className="in"><p>{p.ingredients}</p></div></details>}
            <details className="acc"><summary>Warnings</summary><div className="in"><p>{p.warnings || "Food supplements should not be used as a substitute for a varied, balanced diet and a healthy lifestyle. Do not exceed the recommended daily dose. If you are pregnant, breastfeeding or taking medication, speak to your GP or pharmacist first. Keep out of sight and reach of young children."}</p></div></details>
            <details className="acc"><summary>Delivery & returns</summary><div className="in"><p>UK mainland {gbp(store.delivery.mainland)}{f.freeDelivery.on ? `, free over ${gbpShort(f.freeDelivery.threshold)}` : ""}. Highlands & Islands {gbp(store.delivery.highlands)}. Northern Ireland {gbp(store.delivery.ni)}. Unopened pots can be returned within 30 days.</p></div></details>
          </div>
        </div>
      </div>

      {pairs.length > 0 && (
        <section className="sec"><div className="sec-head"><h2>Often bought together</h2></div><div className="fbt">
          <div className="items">{[p, ...pairs].map((x, i) => (
            <div key={x.id} style={{ display: "contents" }}>
              {i > 0 && <span className="plus">+</span>}
              <div className="it"><div className="im"><ProductArt slug={x.slug} name={x.name} image={x.images[0]?.url} alt="" /></div><label><input type="checkbox" checked disabled /> <span><b>{x.name}</b><br />{gbp(x.price)}</span></label></div>
            </div>
          ))}</div>
          <div style={{ display: "grid", gap: 10, justifyItems: "start" }}>
            <span>Total for {pairs.length + 1}</span><span className="price num" style={{ fontSize: 24 }}>{gbp(fbtTotal)}</span>
            {f.multibuy.on && f.multibuy.mode === "3for2" && pairs.length === 2 && <span className="subprice">3 for 2 applies: you pay {gbp(round2(fbtTotal - Math.min(p.price, ...pairs.map((x) => x.price))))}</span>}
            <button className="btn" disabled={cartBusy} onClick={addPairs}>Add all {pairs.length + 1}</button>
          </div>
        </div></section>
      )}

      {f.reviews.on && (
        <section className="sec" id="reviews"><div className="sec-head"><h2>Reviews</h2></div><div className="reviews">
          <div className="rev-sum"><b style={{ fontSize: 20 }}>{p.review_count ? `${p.rating} out of 5` : "No reviews yet"}</b><p style={{ color: "var(--ink-2)" }}>Reviews appear here after customers receive their order. We ask for one by email 14 days after delivery.</p></div>
          <div className="empty" style={{ textAlign: "left", justifyItems: "start" }}><b>{p.review_count ? `${p.review_count} verified review${p.review_count === 1 ? "" : "s"}` : `Be the first to review ${p.name}`}</b><p>Every review is checked before it goes live, and we never edit what you write.</p></div>
        </div></section>
      )}

      <section className="sec"><div className="sec-head"><h2>{recent.length > 1 ? "You may also like, and recently viewed" : "You may also like"}</h2></div><div className="grid">{also.map((x) => <ProductCard key={x.id} p={x} />)}</div></section>
      <div className="sticky-buy"><div><b>{p.name}</b><div className="num">{gbp(unit)}</div></div><button className="btn" disabled={s === "out" || cartBusy} onClick={buy}>Add to basket</button></div>
    </main>
  );
}
