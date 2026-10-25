"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useShop } from "./ShopProvider";
import { MediaView, ProductArt } from "./ProductArt";
import { WHO, gbp, shopHref, subPrice } from "../../lib/tova/shop";

/**
 * Homepage carousel built on full-width product banners (product on the
 * right, space on the left for the words). Slides, words, pictures, tone and
 * colour come from the admin (site.hero.slides). Timing follows the gold
 * progress bar's CSS animation. The bar only starts once the page is live and
 * the current slide's picture has loaded, so no slide is cut short on a slow
 * connection or missed before the page's code arrives. It keeps moving under
 * the mouse (the hero fills the screen, so the pointer is usually on it);
 * the pause button and keyboard focus freeze it, and with reduced motion on
 * it never moves by itself.
 */
export function HeroCarousel() {
  const { store, bySlug } = useShop();
  const slides = (store?.site.hero.slides ?? []).filter((s) => s.on);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [still, setStill] = useState(false);
  const [ready, setReady] = useState(false); // current slide's picture is on screen
  const [lead, setLead] = useState(0);        // seconds slide 1 was already on screen before the page went live
  const first = useRef(true);
  const startX = useRef<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const n = slides.length;

  useEffect(() => { setStill(matchMedia("(prefers-reduced-motion: reduce)").matches || store?.site.hero.autoplay === false); }, [store?.site.hero.autoplay]);
  const go = useCallback((k: number) => { setLead(0); setI(((k % n) + n) % n); }, [n]);

  // Start the countdown only when this slide's picture has loaded (or failed, or after 6 s at most),
  // and fetch the next slide's picture in the background so it is ready in time.
  useEffect(() => {
    setReady(false);
    const slide = root.current?.querySelectorAll<HTMLElement>(".hero-slide")[i];
    const media = slide?.querySelector<HTMLImageElement | HTMLVideoElement>(".hero-media img, .hero-media video");
    let done = false;
    const go2 = () => { if (!done) { done = true; setReady(true); } };
    // On the first slide, count the time its picture was already showing while the page's code loaded.
    let ahead = 0;
    if (first.current && media instanceof HTMLImageElement && media.complete && media.naturalWidth > 0) {
      const t = performance.getEntriesByName(media.currentSrc || media.src)[0] as PerformanceResourceTiming | undefined;
      if (t?.responseEnd) ahead = Math.max(0, (performance.now() - t.responseEnd) / 1000);
    }
    first.current = false;
    setLead(Math.min(ahead, Math.max(0, (store?.site.hero.intervalSec || 3.9) - 1)));
    const cap = setTimeout(go2, 6000);
    if (!media) go2();
    else if (media instanceof HTMLImageElement) {
      if (media.complete && media.naturalWidth > 0) go2();
      else { media.addEventListener("load", go2, { once: true }); media.addEventListener("error", go2, { once: true }); }
    } else if (media.readyState >= 2) go2();
    else { media.addEventListener("loadeddata", go2, { once: true }); media.addEventListener("error", go2, { once: true }); }
    const next = slides[(i + 1) % Math.max(1, n)]?.media;
    if (next?.kind === "image" && next.src) { const im = new Image(); im.src = next.src; }
    return () => { done = true; clearTimeout(cap); media?.removeEventListener("load", go2); media?.removeEventListener("error", go2); media?.removeEventListener("loadeddata", go2); };
  }, [i, n]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!store || !n) return null;
  const f = store.features;
  const dur = Math.max(3, store.site.hero.intervalSec || 3.9);
  const tone = slides[Math.min(i, n - 1)].tone === "dark" ? "dark" : "light";

  return (
    <div
      ref={root}
      className={`hero-car tone-${tone}${paused ? " paused" : ""}${still ? " still" : ""}${ready ? " run" : ""}`}
      role="region" aria-roledescription="carousel" aria-label="Featured products"
      onKeyDown={(e) => { if (e.key === "ArrowRight") go(i + 1); if (e.key === "ArrowLeft") go(i - 1); }}
      onPointerDown={(e) => { startX.current = e.clientX; }}
      onPointerUp={(e) => {
        if (startX.current === null) return;
        const dx = e.clientX - startX.current; startX.current = null;
        if (Math.abs(dx) > 50) go(dx < 0 ? i + 1 : i - 1);
      }}
      style={{ ["--dur" as string]: `${dur}s`, ["--lead" as string]: `${-lead}s` }}
    >
      <div className="hero-slides">
        {slides.map((s, k) => {
          const p = s.productSlug ? bySlug.get(s.productSlug) : undefined;
          const on = k === i;
          const dark = s.tone === "dark";
          const Title = k === 0 ? "h1" : "h2";
          return (
            <div key={s.id} className={`hero-slide ${dark ? "dark" : "light"}${on ? " on" : ""}`} style={{ ["--slide-bg" as string]: s.bg || (dark ? "#0E0E0E" : "#F3F2EF") }}
              role="group" aria-roledescription="slide" aria-label={`${k + 1} of ${n}: ${s.title}`} aria-hidden={!on} {...(!on ? ({ inert: "" } as Record<string, string>) : {})}>
              <div className="hero-media">
                {s.media ? <MediaView media={s.media} alt={p ? `Tova-Ster ${p.name}` : ""} eager={k === 0 ? "high" : true} />
                  : p ? <ProductArt slug={p.slug} name={p.name} image={p.images[0]?.url} alt="" /> : null}
              </div>
              <div className="hero-copy">
                {s.kicker && <span className="kicker">{s.kicker}</span>}
                <Title className="hero-title">{s.title}</Title>
                <p>{s.text}</p>
                {p && (
                  <div className="hero-price">
                    <b>{gbp(p.price)}</b>
                    {f.subscribe.on && <span>or {gbp(subPrice(p, f))} with Subscribe & Save</span>}
                  </div>
                )}
                <div className="hero-actions">
                  <Link className={`btn ${dark ? "gold" : ""}`} href={s.ctaHref} tabIndex={on ? 0 : -1}>{s.ctaLabel}</Link>
                  {f.quiz.on ? <Link className={`btn ${dark ? "light" : "ghost"}`} href="/quiz" tabIndex={on ? 0 : -1}>Take the 60-second quiz</Link>
                    : <Link className={`btn ${dark ? "light" : "ghost"}`} href="/shop" tabIndex={on ? 0 : -1}>Shop the range</Link>}
                </div>
                {k === 0 && <div className="who" aria-label="Shop by who it's for">{WHO.map((w) => <Link key={w.id} href={shopHref({ who: w.id })} tabIndex={on ? 0 : -1}>{w.name}</Link>)}</div>}
              </div>
            </div>
          );
        })}
      </div>
      {n > 1 && (
        <div className="hero-ctrl">
          <div className="hero-bars">
            {slides.map((s, k) => (
              <button key={s.id} className={`hero-bar${k === i ? " on" : ""}${k < i ? " done" : ""}`} aria-label={`Show slide ${k + 1}: ${s.title}`} aria-current={k === i}
                onClick={() => go(k)}>
                <i key={k === i ? `a${i}` : "x"} onAnimationEnd={() => { if (k === i && !still) go(i + 1); }} />
              </button>
            ))}
          </div>
          <span className="hero-count" aria-hidden="true">{String(i + 1).padStart(2, "0")} / {String(n).padStart(2, "0")}</span>
          <div className="hero-arrows">
            <button onClick={() => go(i - 1)} aria-label="Previous slide">‹</button>
            {!still && <button onClick={() => setPaused(!paused)} aria-label={paused ? "Play slides" : "Pause slides"}>{paused ? "▶" : "❚❚"}</button>}
            <button onClick={() => go(i + 1)} aria-label="Next slide">›</button>
          </div>
        </div>
      )}
    </div>
  );
}
