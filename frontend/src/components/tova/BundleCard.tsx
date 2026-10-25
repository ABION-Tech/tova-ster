"use client";

import { useShop } from "./ShopProvider";
import { ProductArt } from "./ProductArt";
import { gbp, round2 } from "../../lib/tova/shop";
import type { StoreBundle } from "../../lib/tova/types";

export function BundleCard({ b }: { b: StoreBundle }) {
  const { addBundle, cartBusy, bySlug } = useShop();
  // Live prices from the catalogue where we have them (the bundle list can be a few seconds older).
  const base = round2(b.products.reduce((s, p) => s + (bySlug.get(p.slug)?.price ?? p.price), 0));
  const price = round2(base * (1 - b.pct / 100));
  return (
    <article className="bundle">
      <div className="pics">{b.products.map((p) => <div key={p.id}><ProductArt slug={p.slug} name={p.name} image={bySlug.get(p.slug)?.images[0]?.url ?? p.image} alt="" /></div>)}</div>
      <div><h3>{b.name}</h3>{b.blurb && <p>{b.blurb}</p>}</div>
      <div className="foot">
        <div className="price-row"><span className="price num">{gbp(price)}</span><span className="was num">{gbp(base)}</span><span className="tag sale">Save {b.pct}%</span></div>
        <button className="btn sm" disabled={cartBusy} onClick={() => addBundle(b.id, b.name)}>{b.products.length === 2 ? "Add both" : `Add all ${b.products.length}`}</button>
      </div>
    </article>
  );
}
