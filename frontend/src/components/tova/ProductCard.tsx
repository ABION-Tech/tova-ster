"use client";

import Link from "next/link";
import { useShop } from "./ShopProvider";
import { ProductArt } from "./ProductArt";
import { gbp, stockState, subPrice } from "../../lib/tova/shop";
import type { Product } from "../../lib/tova/types";

export function ProductCard({ p }: { p: Product }) {
  const { store, addItem, cartBusy } = useShop();
  if (!store) return null;
  const f = store.features;
  const s = stockState(p);
  const href = `/products/${p.slug}`;
  return (
    <article className="card">
      <Link className="well" href={href} aria-label={`View ${p.name}`}>
        <ProductArt slug={p.slug} name={p.name} image={p.images[0]?.url} alt={p.images[0]?.alt ?? undefined} />
        <span className="tags">
          {p.badge && <span className={`tag ${p.badge === "New" ? "dark" : "gold"}`}>{p.badge}</span>}
          {f.multibuy.on && f.multibuy.mode === "3for2" && <span className="tag sale">3 for 2</span>}
          {s === "low" && <span className="tag">Only {p.onlyLeft} left</span>}
        </span>
      </Link>
      <div className="quick"><button className="btn sm" disabled={s === "out" || cartBusy} onClick={() => addItem(p)}>Quick add</button></div>
      <h3><Link href={href}>{p.name}</Link></h3>
      <div className="price-row">
        <span className="price num">{gbp(p.price)}</span>
        {p.wasPrice && <span className="was num">{gbp(p.wasPrice)}</span>}
        <span className="perday num">{gbp(p.price / Math.max(1, p.servings))} a day</span>
      </div>
      {f.subscribe.on && <div className="subprice num">{gbp(subPrice(p, f))} with Subscribe & Save</div>}
      <button className="btn ghost sm add" disabled={s === "out" || cartBusy} onClick={() => addItem(p)}>{s === "out" ? "Out of stock" : "Add to basket"}</button>
    </article>
  );
}
