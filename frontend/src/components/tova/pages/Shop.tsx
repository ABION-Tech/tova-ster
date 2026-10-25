"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useShop } from "../ShopProvider";
import { ProductCard } from "../ProductCard";
import { Loading } from "../Loading";
import { FORMATS, NEEDS, WHO, shopHref } from "../../../lib/tova/shop";

export type ShopFilters = { need?: string; who?: string; format?: string; q?: string; sort?: string };

export function Shop({ filters: f }: { filters: ShopFilters }) {
  const { store, live } = useShop();
  const router = useRouter();
  if (!store) return <Loading />;

  let list = live;
  if (f.need) list = list.filter((p) => p.needs.includes(f.need!));
  if (f.who) list = list.filter((p) => p.audiences.includes(f.who!));
  if (f.format) list = list.filter((p) => p.format === f.format);
  if (f.q) {
    const q = f.q.toLowerCase();
    list = list.filter((p) => `${p.name} ${p.short_description ?? ""} ${p.needs.join(" ")} ${p.format}`.toLowerCase().includes(q));
  }
  const sort = f.sort || "best";
  if (sort === "low") list = [...list].sort((a, b) => a.price - b.price);
  if (sort === "high") list = [...list].sort((a, b) => b.price - a.price);
  if (sort === "new") list = [...list].sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (sort === "best") list = [...list].sort((a, b) => Number(b.badge === "Best seller") - Number(a.badge === "Best seller") || a.sort_order - b.sort_order);

  const nameOf = (k: string, v: string) => k === "need" ? NEEDS.find((n) => n.id === v)?.name : k === "who" ? WHO.find((w) => w.id === v)?.name : v;
  const title = f.q ? `Results for “${f.q}”` : f.need ? nameOf("need", f.need) : f.who ? nameOf("who", f.who) : f.format ? f.format : "All products";
  const set = (k: keyof ShopFilters, v: string) => router.push(shopHref({ ...f, [k]: v || undefined }), { scroll: false });

  const radio = (key: "need" | "who" | "format", items: readonly (readonly [string, string])[], label: string) => (
    <div><h4>{label}</h4>
      {[["", "All"] as const, ...items].map(([v, l]) => (
        <label key={v}><input type="radio" name={`f-${key}`} value={v} checked={(f[key] || "") === v} onChange={() => set(key, v)} /> {l}</label>
      ))}
    </div>
  );

  return (
    <main className="wrap">
      <nav className="crumbs" aria-label="Breadcrumb"><Link href="/">Home</Link><span>/</span><Link href="/shop">Shop</Link>{title !== "All products" && <><span>/</span><span>{title}</span></>}</nav>
      <div className="shop-head"><div><h1>{title}</h1><p style={{ color: "var(--ink-2)", marginTop: 6 }}>{list.length} product{list.length === 1 ? "" : "s"}{store.features.multibuy.on && store.features.multibuy.mode === "3for2" ? ", all 3 for 2" : ""}</p></div></div>
      <div className="shop-layout">
        <aside className="filters" aria-label="Filters">
          {radio("need", NEEDS.map((n) => [n.id, n.name] as const), "Need")}
          {radio("who", WHO.map((w) => [w.id, w.name] as const), "Who it's for")}
          {radio("format", FORMATS.map((x) => [x, x] as const), "Format")}
        </aside>
        <div>
          <div className="toolbar">
            <div className="chips">{(Object.entries(f) as [keyof ShopFilters, string][]).filter(([k, v]) => v && k !== "sort").map(([k, v]) => (
              <button key={k} className="chip" onClick={() => set(k, "")}>{nameOf(k, v)} ✕</button>
            ))}</div>
            <label className="sr" htmlFor="sort">Sort</label>
            <select id="sort" className="select" value={sort} onChange={(e) => set("sort", e.target.value)}>
              <option value="best">Best sellers</option><option value="new">Newest</option><option value="low">Price, low to high</option><option value="high">Price, high to low</option>
            </select>
          </div>
          {list.length ? <div className="grid three">{list.map((p) => <ProductCard key={p.id} p={p} />)}</div> : (
            <div className="empty"><b>No products match these filters</b><p>Clear a filter or try the quiz for a suggestion.</p><Link className="btn sm" href="/shop">Clear all filters</Link></div>
          )}
        </div>
      </div>
    </main>
  );
}
