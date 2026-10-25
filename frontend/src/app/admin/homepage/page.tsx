"use client";

import { useEffect, useState } from "react";
import { adminJson, BACKEND_URL } from "../../../lib/backend";

interface Media { src: string; kind: "image" | "video" }
interface Slide { id: string; on: boolean; productSlug: string; kicker: string; title: string; text: string; ctaLabel: string; ctaHref: string; media: Media | null; tone: "light" | "dark"; bg: string }
interface Site { hero: { slides: Slide[]; autoplay: boolean; intervalSec: number }; needsAutoplay: boolean; [k: string]: unknown }
interface Product { slug: string; name: string }

const box: React.CSSProperties = { border: "1px solid #E2DFD9", borderRadius: 12, padding: 18, display: "grid", gap: 10, background: "#fff" };
const row: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 };
const lab: React.CSSProperties = { display: "grid", gap: 4, fontSize: 13 };
const inp: React.CSSProperties = { padding: 8, border: "1px solid #D5D1CA", borderRadius: 8, font: "inherit" };

export default function HomepageAdmin() {
  const [site, setSite] = useState<Site | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    adminJson<{ settings: { site: Site } }>("/admin/settings").then((d) => setSite(d.settings.site)).catch((e) => setMsg(e.message));
    fetch(`${BACKEND_URL}/catalogue`).then((r) => r.json()).then((d) => setProducts(d.products ?? [])).catch(() => {});
  }, []);

  if (!site) return <p>{msg ?? "Loading…"}</p>;
  const slides = site.hero.slides;
  const put = (next: Site) => { setSite(next); setDirty(true); setMsg(null); };
  const setSlides = (s: Slide[]) => put({ ...site, hero: { ...site.hero, slides: s } });
  const edit = (i: number, patch: Partial<Slide>) => setSlides(slides.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) => { const s = [...slides]; [s[i], s[i + d]] = [s[i + d], s[i]]; setSlides(s); };
  const nameOf = (slug: string) => products.find((p) => p.slug === slug)?.name ?? slug;

  function add() {
    const p = products[0];
    setSlides([...slides, { id: `s${Date.now().toString(36)}`, on: false, productSlug: p?.slug ?? "", kicker: "", title: "New slide", text: "", ctaLabel: p ? `Shop ${p.name}` : "Shop now", ctaHref: p ? `/products/${p.slug}` : "/shop", media: null, tone: "light", bg: "#F2EEEA" }]);
  }

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const d = await adminJson<{ settings: { site: Site } }>("/admin/settings/site", { method: "PUT", body: JSON.stringify({ value: site }) });
      setSite(d.settings.site); setDirty(false);
      setMsg("Saved. The shop shows the change within a minute.");
    } catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't save."); } finally { setBusy(false); }
  }

  return (
    <div style={{ display: "grid", gap: 20, maxWidth: 1000 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Homepage</h1>
        <button className="btn" disabled={busy || !dirty} onClick={save}>{busy ? "Saving…" : dirty ? "Save changes" : "Saved"}</button>
      </div>
      {msg && <div style={{ padding: 12, borderRadius: 8, background: "#F4EAD3" }} role="status">{msg}</div>}
      <div style={{ padding: 12, borderRadius: 8, background: "#EEF2F7", fontSize: 13 }}>
        Health wording must use the approved GB claims only, worded in full and naming the nutrient (for example &ldquo;Vitamin C contributes to normal collagen formation for the normal function of skin&rdquo;). Don&apos;t add pack sizes here; the product page shows them.
      </div>

      <section style={box}>
        <b>Hero carousel</b>
        <div style={row}>
          <label style={{ ...lab, gridAutoFlow: "column", justifyContent: "start", alignItems: "center", gap: 8 }}><input type="checkbox" checked={site.hero.autoplay} onChange={(e) => put({ ...site, hero: { ...site.hero, autoplay: e.target.checked } })} /> Slide on its own</label>
          <label style={lab}>Seconds per slide<input style={inp} type="number" min={3} max={20} step={0.1} value={site.hero.intervalSec} onChange={(e) => put({ ...site, hero: { ...site.hero, intervalSec: Math.min(20, Math.max(3, Math.round((Number(e.target.value) || 3.9) * 10) / 10)) } })} /></label>
          <label style={{ ...lab, gridAutoFlow: "column", justifyContent: "start", alignItems: "center", gap: 8 }}><input type="checkbox" checked={site.needsAutoplay} onChange={(e) => put({ ...site, needsAutoplay: e.target.checked })} /> &ldquo;Shop by need&rdquo; row slides on its own</label>
        </div>
        <span style={{ fontSize: 13, color: "#6E685E" }}>{slides.filter((s) => s.on).length} of {slides.length} slides showing. Up to 8.</span>
      </section>

      {slides.map((s, i) => (
        <section key={s.id} style={{ ...box, opacity: s.on ? 1 : 0.7 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <b style={{ flex: 1 }}>Slide {i + 1}: {nameOf(s.productSlug)}</b>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}><input type="checkbox" checked={s.on} onChange={(e) => edit(i, { on: e.target.checked })} /> Showing</label>
            <button className="btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
            <button className="btn" disabled={i === slides.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
            <button className="btn" onClick={() => confirm("Remove this slide?") && setSlides(slides.filter((_, k) => k !== i))}>Remove</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 220px) 1fr", gap: 14 }}>
            <div style={{ borderRadius: 10, overflow: "hidden", background: s.bg, aspectRatio: "16 / 9", display: "grid", placeItems: "center", fontSize: 12, color: "#6E685E" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {s.media?.src ? (s.media.kind === "video" ? <video src={s.media.src} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <img src={s.media.src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />) : "No picture"}
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              <div style={row}>
                <label style={lab}>Product<select style={inp} value={s.productSlug} onChange={(e) => { const p = products.find((x) => x.slug === e.target.value); edit(i, { productSlug: e.target.value, ctaHref: `/products/${e.target.value}`, ctaLabel: p ? `Shop ${p.name}` : s.ctaLabel }); }}>
                  {products.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
                </select></label>
                <label style={lab}>Small line above the title<input style={inp} value={s.kicker} maxLength={60} onChange={(e) => edit(i, { kicker: e.target.value })} /></label>
              </div>
              <label style={lab}>Title<input style={inp} value={s.title} maxLength={80} onChange={(e) => edit(i, { title: e.target.value })} /></label>
              <label style={lab}>Write-up<textarea style={{ ...inp, minHeight: 70 }} value={s.text} maxLength={300} onChange={(e) => edit(i, { text: e.target.value })} /></label>
            </div>
          </div>
          <div style={row}>
            <label style={lab}>Button text<input style={inp} value={s.ctaLabel} maxLength={40} onChange={(e) => edit(i, { ctaLabel: e.target.value })} /></label>
            <label style={lab}>Button goes to<input style={inp} value={s.ctaHref} onChange={(e) => edit(i, { ctaHref: e.target.value })} /></label>
            <label style={lab}>Banner picture or video (link)<input style={inp} value={s.media?.src ?? ""} placeholder="/brand/hero-… or https://…" onChange={(e) => { const v = e.target.value.trim(); edit(i, { media: v ? { src: v, kind: /\.(mp4|webm|mov)(\?|$)/i.test(v) ? "video" : "image" } : null }); }} /></label>
            <label style={lab}>Picture is<select style={inp} value={s.tone} onChange={(e) => edit(i, { tone: e.target.value as "light" | "dark" })}><option value="light">Light (dark words)</option><option value="dark">Dark (white words)</option></select></label>
            <label style={lab}>Colour behind words on phones<input style={{ ...inp, padding: 2, height: 38 }} type="color" value={s.bg} onChange={(e) => edit(i, { bg: e.target.value.toUpperCase() })} /></label>
          </div>
        </section>
      ))}

      <div><button className="btn" disabled={slides.length >= 8} onClick={add}>Add a slide</button></div>
    </div>
  );
}
