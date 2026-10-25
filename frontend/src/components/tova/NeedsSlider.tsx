"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useShop } from "./ShopProvider";
import { MediaView, ProductArt } from "./ProductArt";
import { NEEDS, shopHref } from "../../lib/tova/shop";

const SPEED = 38;   // pixels per second for the continuous glide
const RESUME = 2500; // ms to wait after a touch, drag or arrow press before gliding again

/**
 * "Shop by need" as a continuous, looping glide. The cards are drawn twice so
 * the row never runs out; the offset wraps at one full set. It pauses while a
 * shopper hovers, touches, drags or tabs into it, can be swiped or nudged with
 * the arrows, and never moves on its own with reduced motion turned on.
 */
export function NeedsSlider() {
  const { store, bySlug } = useShop();
  const view = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const x = useRef(0);                 // current offset in px
  const hover = useRef(false);
  const holdUntil = useRef(0);         // paused until this time (touch / arrows)
  const tween = useRef<{ from: number; to: number; t0: number } | null>(null);
  const drag = useRef<{ id: number; startX: number; startOff: number; moved: boolean } | null>(null);
  const visible = useRef(true);
  const [page, setPage] = useState(0);
  const auto = store?.site.needsAutoplay !== false;

  const setLength = () => {
    const el = track.current; if (!el) return 0;
    const second = el.children[NEEDS.length] as HTMLElement | undefined;
    return second ? second.offsetLeft : el.scrollWidth / 2; // width of one full set including its gap
  };
  const cardStep = () => {
    const el = track.current; if (!el || el.children.length < 2) return 300;
    return (el.children[1] as HTMLElement).offsetLeft - (el.children[0] as HTMLElement).offsetLeft;
  };
  const paint = () => {
    const el = track.current; if (!el) return;
    const len = setLength();
    if (len > 0) x.current = ((x.current % len) + len) % len;
    el.style.transform = `translate3d(${-x.current}px,0,0)`;
    const p = Math.round(x.current / cardStep()) % NEEDS.length;
    setPage((old) => (old === p ? old : p));
  };

  useEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    const io = new IntersectionObserver(([e]) => { visible.current = e.isIntersecting; }, { threshold: 0.1 });
    if (view.current) io.observe(view.current);
    let raf = 0; let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(64, now - last) / 1000; last = now;
      const tw = tween.current;
      if (tw) {
        const k = Math.min(1, (now - tw.t0) / 450);
        const ease = 1 - Math.pow(1 - k, 3);
        x.current = tw.from + (tw.to - tw.from) * ease;
        if (k >= 1) tween.current = null;
        paint();
      } else if (auto && !reduce.matches && visible.current && !hover.current && !drag.current && now > holdUntil.current && !document.hidden) {
        x.current += SPEED * dt;
        paint();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const onResize = () => paint();
    addEventListener("resize", onResize);
    return () => { cancelAnimationFrame(raf); io.disconnect(); removeEventListener("resize", onResize); };
  }, [auto]); // eslint-disable-line react-hooks/exhaustive-deps

  const nudge = (dir: 1 | -1) => {
    const s = cardStep();
    const base = Math.round(x.current / s) * s;
    tween.current = { from: x.current, to: base + dir * s, t0: performance.now() };
    holdUntil.current = performance.now() + RESUME;
  };

  // Swipe / drag with a finger or mouse; a drag never counts as a click on the card.
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    tween.current = null;
    drag.current = { id: e.pointerId, startX: e.clientX, startOff: x.current, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) > 6) { d.moved = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }
    if (d.moved) { x.current = d.startOff - dx; paint(); }
  };
  const endDrag = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    if (d.moved) {
      const s = cardStep();
      tween.current = { from: x.current, to: Math.round(x.current / s) * s, t0: performance.now() };
      const block = (ev: Event) => { ev.preventDefault(); ev.stopPropagation(); };
      view.current?.addEventListener("click", block, { capture: true, once: true });
      setTimeout(() => view.current?.removeEventListener("click", block, { capture: true }), 0);
    }
    drag.current = null;
    holdUntil.current = performance.now() + RESUME;
  };

  // Keyboard: bring the focused card fully into view.
  const onFocus = (e: React.FocusEvent) => {
    hover.current = true;
    const card = (e.target as HTMLElement).closest(".need") as HTMLElement | null;
    const v = view.current;
    if (!card || !v) return;
    const left = card.offsetLeft - x.current;
    if (left < 0 || left + card.offsetWidth > v.clientWidth) tween.current = { from: x.current, to: card.offsetLeft, t0: performance.now() };
  };

  if (!store) return null;
  const cards = [...NEEDS, ...NEEDS];
  return (
    <section className="sec needs-sec"><div className="wrap">
      <div className="sec-head">
        <div><h2>Shop by need</h2><p>Start with what matters to you.</p></div>
        <div className="slider-nav">
          <button onClick={() => nudge(-1)} aria-label="Previous needs">‹</button>
          <button onClick={() => nudge(1)} aria-label="More needs">›</button>
        </div>
      </div>
      <div className="slider marquee" ref={view}
        onPointerEnter={(e) => { if (e.pointerType === "mouse") hover.current = true; }}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") hover.current = false; }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
        onFocus={onFocus} onBlur={() => { hover.current = false; }}>
        <div className="slider-track" ref={track} role="list" aria-label="Shop by need">
          {cards.map((n, k) => {
            const copy = k >= NEEDS.length; // the second set only exists to make the loop seamless
            const hero = bySlug.get(n.hero);
            return (
              <Link key={`${n.id}-${k}`} role={copy ? undefined : "listitem"} aria-hidden={copy || undefined} tabIndex={copy ? -1 : undefined}
                className="need" href={shopHref({ need: n.id })} style={{ background: n.color, color: n.ink }} draggable={false}>
                <span style={{ display: "grid", gap: 6, position: "relative", zIndex: 1 }}><b>{n.name}</b><small>{n.note}</small></span>
                <span className="pic">{store.site.needs[n.id] ? <MediaView media={store.site.needs[n.id]} /> : hero ? <ProductArt slug={hero.slug} name={hero.name} image={hero.images[0]?.url} alt="" /> : null}</span>
              </Link>
            );
          })}
        </div>
      </div>
      <div className="slider-dots" aria-hidden="true">{NEEDS.map((n, k) => <span key={n.id} className={k === page ? "on" : ""} />)}</div>
    </div></section>
  );
}
