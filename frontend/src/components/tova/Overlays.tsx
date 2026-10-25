"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useShop } from "./ShopProvider";
import { Icon } from "./Icons";
import { ProductArt } from "./ProductArt";
import { BasketLine, Summary, basketRows } from "./BasketLines";
import { NEEDS, WHO, gbp, shopHref } from "../../lib/tova/shop";
import { FreebiePopup } from "./Freebie";

/** Close on Escape and keep focus inside while a drawer is open. */
function useDialog(open: boolean, close: () => void) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.querySelector<HTMLElement>("button, a, input")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab" && el) {
        const items = [...el.querySelectorAll<HTMLElement>("button:not([disabled]), a, input, select")];
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; prev?.focus?.(); };
  }, [open, close]);
  return ref;
}

function BasketDrawer() {
  const { store, cart, drawer, setDrawer, applyCode, setRedeem, user, live, addItem, cartBusy } = useShop();
  const close = () => setDrawer(false);
  const ref = useDialog(drawer, close);
  const [code, setCode] = useState("");
  const [codeErr, setCodeErr] = useState<string | null>(null);
  useEffect(() => { setCode(cart?.code ?? ""); }, [cart?.code]);
  if (!drawer || !store) return null;
  const f = store.features;
  const p = cart?.pricing;
  const rows = cart ? basketRows(cart) : [];
  const has = rows.length > 0 && p;

  const oneTimeUnits = cart?.items.filter((l) => !l.bundleId && !l.isSubscription).reduce((s, l) => s + l.quantity, 0) ?? 0;
  const mbHint = f.multibuy.on && f.multibuy.mode === "3for2" && oneTimeUnits % 3 ? `Add ${3 - (oneTimeUnits % 3)} more for your 3 for 2 saving` : "";
  const inCart = new Set(cart?.items.map((l) => l.productId));
  const xs = f.crossSell.on ? live.filter((x) => !inCart.has(x.id) && x.inStock).sort((a, b) => Number(b.badge === "Best seller") - Number(a.badge === "Best seller")).slice(0, 2) : [];

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    setCodeErr(await applyCode(code.trim() || null));
  }

  return (
    <>
      <div className="scrim" onClick={close} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Your basket" ref={ref}>
        <header><h2>Your basket{p?.itemCount ? ` (${p.itemCount})` : ""}</h2><button className="icon-btn" onClick={close} aria-label="Close basket"><Icon.x /></button></header>
        <div className="body">
          {has ? (
            <>
              {f.freeDelivery.on && p.freeDeliveryThreshold !== null && (
                <div className="ship">
                  <span>{p.amountToFreeDelivery > 0 ? <>You&apos;re <b>{gbp(p.amountToFreeDelivery)}</b> away from free UK delivery</> : <b>You&apos;ve got free UK delivery</b>}</span>
                  <div className="bar"><span style={{ width: `${Math.min(100, (p.merchandise / p.freeDeliveryThreshold) * 100)}%` }} /></div>
                </div>
              )}
              {mbHint && <div className="notice gold">{mbHint}</div>}
              {rows.map((r) => <BasketLine key={r.kind === "single" ? r.line.id : r.bundleId} row={r} />)}
              {f.codes.on && (
                <>
                  <form className="codebox" onSubmit={submitCode}>
                    <label className="sr" htmlFor="code">Discount code</label>
                    <input id="code" placeholder="Discount code" value={code} onChange={(e) => { setCode(e.target.value); setCodeErr(null); }} autoCapitalize="characters" />
                    {cart.code && !codeErr && code.trim().toUpperCase() === cart.code
                      ? <button className="btn ghost sm" type="button" onClick={async () => { setCode(""); setCodeErr(await applyCode(null)); }}>Remove</button>
                      : <button className="btn ghost sm" type="submit">Apply</button>}
                  </form>
                  {(codeErr || cart.codeError) && <div className="notice warn">{codeErr ?? cart.codeError}</div>}
                </>
              )}
              {f.rewards.on && (user ? (
                cart.pointsBalance >= f.rewards.minRedeem
                  ? <label className="notice gold" style={{ cursor: "pointer" }}><input type="checkbox" checked={cart.redeemPoints} disabled={cartBusy} onChange={(e) => setRedeem(e.target.checked)} /> Use {Math.floor(cart.pointsBalance / 100) * 100} of your {cart.pointsBalance} points</label>
                  : <div className="notice gold">You have {cart.pointsBalance} points. Spend them from {f.rewards.minRedeem}.</div>
              ) : <div className="notice gold"><Link href="/account" onClick={close}>Sign in</Link> to earn {p.pointsEarned} points on this order</div>)}
              {xs.length > 0 && (
                <div className="xsell"><h4>Pairs well with</h4>
                  {xs.map((x) => (
                    <div className="row" key={x.id}>
                      <div className="im"><ProductArt slug={x.slug} name={x.name} image={x.images[0]?.url} alt="" /></div>
                      <span><b>{x.name}</b><br />{gbp(x.price)}</span>
                      <button className="btn ghost sm" disabled={cartBusy} onClick={() => addItem(x)}>Add</button>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="empty"><b>Your basket is empty</b><p>Not sure where to start?</p>
              {f.quiz.on && <Link className="btn sm" href="/quiz" onClick={close}>Take the quiz</Link>}
              <Link className="btn ghost sm" href="/shop" onClick={close}>Shop all</Link>
            </div>
          )}
        </div>
        {has && (
          <div className="foot">
            <Summary p={p} vatRate={store.delivery.vat} rewardsOn={false} showLines={false} />
            {f.rewards.on && <div style={{ fontSize: 13, color: "var(--gold-ink)", fontWeight: 600 }}>You&apos;ll earn {p.pointsEarned} points</div>}
            {cart.hasBlockingIssues
              ? <button className="btn block" disabled>Fix the items above to check out</button>
              : <Link className="btn block" href="/checkout" onClick={close}>Checkout securely</Link>}
          </div>
        )}
      </aside>
    </>
  );
}

function MobileMenu() {
  const { store, menu, setMenu, user, cart } = useShop();
  const router = useRouter();
  const close = () => setMenu(false);
  const ref = useDialog(menu, close);
  const [q, setQ] = useState("");
  if (!menu || !store) return null;
  const f = store.features;
  return (
    <>
      <div className="scrim" onClick={close} />
      <aside className="drawer left" role="dialog" aria-modal="true" aria-label="Menu" ref={ref}>
        <header>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <Link className="logo" href="/" onClick={close}><img src="/brand/monogram.png" alt="" /><b>TOVA-STER</b></Link>
          <button className="icon-btn" onClick={close} aria-label="Close menu"><Icon.x /></button>
        </header>
        <div className="body">
          <form className="codebox" onSubmit={(e) => { e.preventDefault(); if (q.trim()) { close(); router.push(shopHref({ q: q.trim() })); } }}>
            <label className="sr" htmlFor="mq">Search products</label>
            <input id="mq" type="search" placeholder="Search vitamins, gummies…" value={q} onChange={(e) => setQ(e.target.value)} style={{ textTransform: "none" }} />
            <button className="btn sm" type="submit">Search</button>
          </form>
          {f.quiz.on && <Link className="btn gold block" href="/quiz" onClick={close}>Find your vitamins</Link>}
          <div className="mgroup"><h4>Shop by need</h4>{NEEDS.map((n) => <Link key={n.id} href={shopHref({ need: n.id })} onClick={close}>{n.name}</Link>)}</div>
          <div className="mgroup"><h4>Who it&apos;s for</h4>{WHO.map((w) => <Link key={w.id} href={shopHref({ who: w.id })} onClick={close}>{w.name}</Link>)}</div>
          <div className="mgroup"><h4>More</h4>
            <Link href="/shop" onClick={close}>Shop all</Link>
            {(f.bundles.on || f.multibuy.on) && <Link href="/offers" onClick={close}>Offers</Link>}
            <Link href="/account" onClick={close}>{user ? `My account${f.rewards.on && cart ? `, ${cart.pointsBalance} points` : ""}` : "Sign in"}</Link>
            {store.site.insta.on && <Link href="/instagram" onClick={close}>Instagram @{store.site.insta.handle}</Link>}
            <Link href="/help" onClick={close}>Help & delivery</Link>
          </div>
        </div>
      </aside>
    </>
  );
}

function CookieBar() {
  const { consent, setConsent } = useShop();
  if (consent) return null;
  return (
    <aside className="cookiebar" role="region" aria-label="Cookie choices">
      <p><b>Cookies on Tova-Ster.</b> We use essential cookies to run the shop and remember your basket. With your OK we&apos;ll also use analytics cookies to see how the shop is used, so we can improve it. <Link className="link" href="/help#privacy">Read more</Link></p>
      <div className="cbtns"><button className="btn ghost sm" onClick={() => setConsent("essential")}>Essential only</button><button className="btn sm" onClick={() => setConsent("all")}>Accept all</button></div>
    </aside>
  );
}

function Toast() {
  const { toast, setDrawer, drawer } = useShop();
  if (!toast || (drawer && toast.basket)) return null; // the open basket already shows it
  return (
    <div className="toast" role="status">
      <span>{toast.msg}</span>
      {toast.basket && <button onClick={() => setDrawer(true)}>View basket</button>}
    </div>
  );
}

/** Close drawers on navigation and log page views (with consent). */
function RouteWatcher() {
  const path = usePathname();
  const { setDrawer, setMenu, track } = useShop();
  useEffect(() => { setMenu(false); if (!path.startsWith("/products/")) track("view", `Viewed ${path}`, { path }); }, [path]); // product pages log their own view with the product name // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDrawer(false); }, [path]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export function Overlays() {
  return <><BasketDrawer /><MobileMenu /><CookieBar /><FreebiePopup /><Toast /><RouteWatcher /></>;
}
