"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useShop } from "./ShopProvider";
import { Icon } from "./Icons";
import { ProductArt } from "./ProductArt";
import { FORMATS, NEEDS, WHO, gbp, shopHref } from "../../lib/tova/shop";
import { memory } from "../../lib/tova/memory";

function Announcement({ messages }: { messages: string[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (messages.length < 2 || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, [messages.length]);
  return <div className="announce" aria-live="polite"><span key={i}>{messages[i % messages.length]}</span></div>;
}

function Search() {
  const { live, track } = useShop();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { setRecentSearches(memory.get<string[]>("searches") ?? []); }, []);
  useEffect(() => {
    const close = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const v = q.trim().toLowerCase();
  const res = v
    ? live.filter((p) => `${p.name} ${p.short_description ?? ""} ${p.needs.join(" ")} ${p.format}`.toLowerCase().includes(v)).slice(0, 4)
    : live.filter((p) => p.badge === "Best seller").slice(0, 3);

  function go(term: string) {
    const t = term.trim();
    if (!t) return;
    const list = [t.toLowerCase(), ...recentSearches.filter((r) => r !== t.toLowerCase())].slice(0, 4);
    memory.set("searches", list); setRecentSearches(list);
    const found = live.filter((p) => `${p.name} ${p.short_description ?? ""} ${p.needs.join(" ")} ${p.format}`.toLowerCase().includes(t.toLowerCase())).length;
    track("search", `Searched “${t}”${found ? ` (${found} found)` : " (nothing found)"}`, { q: t.toLowerCase(), results: found, noResults: found === 0 });
    setOpen(false);
    router.push(shopHref({ q: t }));
  }

  return (
    <div className="search" ref={box}>
      <label className="sr" htmlFor="q">Search products</label>
      <Icon.search />
      <input id="q" type="search" placeholder="Search vitamins, gummies…" autoComplete="off" value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === "Enter") go(q); if (e.key === "Escape") setOpen(false); }} />
      {open && (
        <div className="sugg">
          <div>
            <h4>{v ? "Products" : "Popular right now"}</h4>
            {res.length ? res.map((p) => (
              <Link key={p.id} className="row" href={`/products/${p.slug}`} onClick={() => setOpen(false)}>
                <span className="th"><ProductArt slug={p.slug} name={p.name} image={p.images[0]?.url} alt="" /></span>
                <span><b>{p.name}</b><br /><span className="num" style={{ color: "var(--ink-2)" }}>{gbp(p.price)}</span></span>
              </Link>
            )) : <p style={{ fontSize: 14 }}>No products match “{q}”.</p>}
          </div>
          {v ? <button className="btn ghost sm" onClick={() => go(q)}>See all results</button>
            : recentSearches.length > 0 && (
              <div><h4>Recent searches</h4><div className="chips">{recentSearches.map((r) => <button key={r} className="chip" onClick={() => go(r)}>{r}</button>)}</div></div>
            )}
        </div>
      )}
    </div>
  );
}

export function Header() {
  const { store, cart, user, setDrawer, setMenu } = useShop();
  if (!store) return null;
  const f = store.features;
  const count = cart?.pricing.itemCount ?? 0;
  return (
    <>
      {f.announcement.on && f.announcement.messages.length > 0 && <Announcement messages={f.announcement.messages} />}
      <header className="hdr"><div className="wrap">
        <button className="icon-btn burger" onClick={() => setMenu(true)} aria-label="Open menu"><Icon.menu /></button>
        <Link className="logo" href="/" aria-label="Tova-Ster home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/monogram.png" alt="" /><b>TOVA-STER</b>
        </Link>
        <nav className="mainnav" aria-label="Main">
          <div><Link href="/shop">Shop</Link>
            <div className="mega"><div className="wrap">
              <div><h4>By need</h4><ul>{NEEDS.map((n) => <li key={n.id}><Link href={shopHref({ need: n.id })}>{n.name}</Link></li>)}</ul></div>
              <div><h4>Who it&apos;s for</h4><ul>{WHO.map((w) => <li key={w.id}><Link href={shopHref({ who: w.id })}>{w.name}</Link></li>)}</ul></div>
              <div><h4>By format</h4><ul>{FORMATS.map((x) => <li key={x}><Link href={shopHref({ format: x })}>{x}</Link></li>)}<li><Link href="/shop">Shop all</Link></li></ul></div>
              {f.quiz.on ? (
                <div className="promo"><h3>Not sure where to start?</h3><p>Answer a few quick questions and get a short list made for you{f.quiz.discount ? `, with ${f.quiz.discount}% off the set` : ""}.</p><div><Link className="btn gold sm" href="/quiz">Find your vitamins</Link></div></div>
              ) : (
                <div className="promo"><h3>Best sellers</h3><p>The pots people come back for.</p><div><Link className="btn gold sm" href={shopHref({ sort: "best" })}>Shop best sellers</Link></div></div>
              )}
            </div></div>
          </div>
          <div><Link href={shopHref({ who: "kids" })}>Kids</Link></div>
          {(f.bundles.on || f.multibuy.on) && <div><Link href="/offers">Offers</Link></div>}
          {f.quiz.on && <div><Link href="/quiz">Find your vitamins</Link></div>}
        </nav>
        <div className="tools">
          <Search />
          {f.rewards.on && user && cart && <Link className="pts-pill" href="/account">{cart.pointsBalance} points</Link>}
          <Link className="icon-btn" href="/account" aria-label="Your account"><Icon.user /></Link>
          <button className="icon-btn" onClick={() => setDrawer(true)} aria-label={`Basket, ${count} items`}><Icon.bag />{count > 0 && <span className="badge-count">{count}</span>}</button>
        </div>
      </div></header>
    </>
  );
}
