"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useShop } from "../ShopProvider";
import { ProductCard } from "../ProductCard";
import { BundleCard } from "../BundleCard";
import { HeroCarousel } from "../HeroCarousel";
import { NeedsSlider } from "../NeedsSlider";
import { InstagramStrip } from "../Instagram";
import { FreebieOffer } from "../Freebie";
import { Icon } from "../Icons";
import { MediaView, ProductArt } from "../ProductArt";
import { Loading } from "../Loading";
import { NEEDS, WHO, gbp, gbpShort, hourLabel, shopHref } from "../../../lib/tova/shop";
import { newsletterApi } from "../../../lib/tova/api";

export function Home() {
  const { store, live, bySlug, recent, quiz, track } = useShop();
  const [tab, setTab] = useState<"best" | "new" | "gummies">("best");
  const [news, setNews] = useState<{ email: string; ok?: boolean; err?: string }>({ email: "" });
  if (!store) return <Loading />;
  const f = store.features, site = store.site, d = store.delivery;

  const best = [...live.filter((p) => p.badge === "Best seller"), ...live.filter((p) => p.badge !== "Best seller")].slice(0, 5);
  const tabList = tab === "best" ? best
    : tab === "new" ? [...live].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5)
    : [...new Set([...live.filter((p) => p.format === "Gummies"), ...live.filter((p) => p.audiences.includes("kids"))])].slice(0, 5);
  const recentProducts = recent.map((s) => bySlug.get(s)).filter((p): p is NonNullable<typeof p> => !!p).slice(0, 5);
  const quizSet = (quiz.productSlugs ?? []).map((s) => bySlug.get(s)).filter((p): p is NonNullable<typeof p> => !!p);

  async function signup(e: FormEvent) {
    e.preventDefault();
    try { await newsletterApi.signup(news.email); setNews({ email: "", ok: true }); track("newsletter", "Signed up to emails"); }
    catch (err) { setNews({ ...news, err: err instanceof Error ? err.message : "Please try again." }); }
  }

  return (
    <main>
      <section className="hero"><div className="hero-bleed"><HeroCarousel /></div><div className="wrap">
      <div className="trust">
        <div><Icon.truck /><span><b>{f.freeDelivery.on ? `Free UK delivery over ${gbpShort(f.freeDelivery.threshold)}` : "Fast UK delivery"}</b>Order by {hourLabel(d.cutoffHour)}, sent today</span></div>
        <div><Icon.repeat /><span><b>{f.subscribe.on ? `Subscribe & save ${f.subscribe.discount}%` : "Easy reorders"}</b>Skip or cancel any time</span></div>
        <div><Icon.star /><span><b>{f.rewards.on ? `Earn ${f.rewards.earn} points per £1` : "Clear, simple labels"}</b>{f.rewards.on ? `${f.rewards.signup} points when you join` : "Authorised claims only"}</span></div>
        <div><Icon.lock /><span><b>Secure checkout</b>Apple Pay, Google Pay{f.payments.paypal ? ", PayPal" : ""}</span></div>
      </div></div></section>

      {quizSet.length > 0 && (
        <section className="sec"><div className="wrap"><div className="band quizband">
          <div><h2>Your quiz set is saved</h2><p>{quizSet.map((p) => p.name).join(", ")}. Pick up where you left off{f.quiz.discount ? `, still with ${f.quiz.discount}% off the set` : ""}.</p>
            <div className="actions"><Link className="btn" href="/quiz?result=1">See my set</Link></div></div>
          <div className="qpreview" aria-hidden="true">{quizSet.slice(0, 3).map((p) => <div className="opt on" key={p.id}>{p.name}<span>✓</span></div>)}</div>
        </div></div></section>
      )}

      <NeedsSlider />

      <section className="sec"><div className="wrap">
        <div className="sec-head"><div><h2>Most loved</h2>{f.multibuy.on && f.multibuy.mode === "3for2" && <p>Mix any three and the cheapest is free.</p>}</div>
          <div className="tabs" role="group" aria-label="Product lists">
            {([["best", "Best sellers"], ["new", "New in"], ["gummies", "Gummies"]] as const).map(([k, l]) => <button key={k} className="chip" aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}
          </div></div>
        <div className="grid fill5">{tabList.map((p) => <ProductCard key={p.id} p={p} />)}</div>
      </div></section>

      {recentProducts.length > 0 && (
        <section className="sec"><div className="wrap">
          <div className="sec-head"><div><h2>Recently viewed</h2><p>Pick up where you left off.</p></div></div>
          <div className="grid fill5">{recentProducts.map((p) => <ProductCard key={p.id} p={p} />)}</div>
        </div></section>
      )}

      {f.quiz.on && !quizSet.length && (
        <section className="sec"><div className="wrap"><div className="band quizband">
          <div><h2>Not sure which vitamins you need?</h2><p>Answer a few quick questions about who you&apos;re shopping for and what you'd like to focus on. We&apos;ll suggest up to {f.quiz.max} products and explain why{f.quiz.discount ? `, with ${f.quiz.discount}% off if you take the set` : ""}.</p><div className="actions"><Link className="btn" href="/quiz">Start the quiz</Link></div></div>
          <div className="qpreview" aria-hidden="true"><div className="qbar"><span style={{ width: "40%" }} /></div><b>What would you like to focus on?</b><div className="opt on">Energy & tiredness<span>✓</span></div><div className="opt on">Immunity<span>✓</span></div><div className="opt">Skin, hair & nails</div><div className="opt">Training</div></div>
        </div></div></section>
      )}

      {f.bundles.on && store.bundles.length > 0 && (
        <section className="sec"><div className="wrap">
          <div className="sec-head"><div><h2>Routines that save</h2><p>Pairs that work together, at a lower price than buying separately.</p></div></div>
          <div className="bundles">{store.bundles.map((b) => <BundleCard key={b.id} b={b} />)}</div>
        </div></section>
      )}

      {(f.subscribe.on || f.rewards.on) && (
        <section className="sec"><div className="wrap"><div className="perks" style={!(f.subscribe.on && f.rewards.on) ? { gridTemplateColumns: "1fr" } : undefined}>
          {f.subscribe.on && (
            <div className="perk dark"><span className="big-figure">{f.subscribe.discount}% off</span><h2>Subscribe & Save</h2><p>Choose how often your pots arrive and we&apos;ll send them before you run out.</p>
              <ul><li>Delivered every {f.subscribe.freqs.map((m) => (m === 1 ? "month" : `${m} months`)).join(", every ")}</li><li>Skip, pause or cancel in your account, no calls</li><li>We remind you before each delivery</li></ul>
              <div><Link className="btn gold" href="/shop">Choose your products</Link></div></div>
          )}
          {f.rewards.on && (
            <div className="perk light"><span className="big-figure">{f.rewards.earn} pts</span><h2>for every £1 you spend</h2><p>Points turn into money off. 100 points take {gbp(f.rewards.pointValue)} off your order.</p>
              <ul><li>{f.rewards.signup} points when you create an account</li><li>Spend from {f.rewards.minRedeem} points at checkout</li><li>Points on subscription orders too</li></ul>
              <div><Link className="btn" href="/account">Join and get {f.rewards.signup} points</Link></div></div>
          )}
        </div></div></section>
      )}

      {site.banner.on && site.banner.media && (
        <section className="sec"><div className="wrap"><div className="storyband">
          <MediaView media={site.banner.media} className="storymedia" />
          <div className="storycopy"><h2>{site.banner.title}</h2><p>{site.banner.text}</p><div><Link className="btn light" href="/shop">Shop the range</Link></div></div>
        </div></div></section>
      )}

      <InstagramStrip />

      {f.freebie?.on ? (
        <section className="sec"><div className="wrap"><FreebieOffer where="home" /></div></section>
      ) : (
      <section className="sec"><div className="wrap"><div className="news">
        <div><h2>{f.welcome.on ? `${f.welcome.pct}% off your first order` : "News, offers and new products"}</h2><p style={{ color: "var(--ink-2)", marginTop: 8 }}>One email a fortnight: new products, offers, and practical guides such as vitamin D in a UK winter.</p></div>
        {news.ok ? (
          <div className="notice good">Thanks, you&apos;re signed up.{f.welcome.on ? <> Use code <b>{f.welcome.code}</b> on your first order.</> : null}</div>
        ) : (
          <form onSubmit={signup}>
            <label className="sr" htmlFor="nemail">Email address</label>
            <input id="nemail" type="email" required placeholder="Your email address" value={news.email} onChange={(e) => setNews({ email: e.target.value })} />
            <button className="btn" type="submit">Sign up</button>
            <label className="consent"><input type="checkbox" required /> I&apos;m 18 or over and happy to receive marketing emails. Unsubscribe any time.</label>
            {news.err && <p className="formerr">{news.err}</p>}
          </form>
        )}
      </div></div></section>
      )}
    </main>
  );
}
