"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useShop } from "./ShopProvider";
import { Icon } from "./Icons";
import { igApi } from "../../lib/tova/api";
import { memory } from "../../lib/tova/memory";
import type { IgFeed, IgPost } from "../../lib/tova/types";

const KindIcon = ({ type }: { type: IgPost["type"] }) =>
  type === "video" ? <svg className="kind" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-label="Reel"><path d="M8 5v14l11-7z" /></svg>
    : type === "album" ? <svg className="kind" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-label="Several photos"><rect x="7" y="7" width="13" height="13" rx="2" /><path d="M4 16V6a2 2 0 012-2h10" /></svg>
    : null;

const when = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "");

/** Loads the feed (server copy first, then the live one), remembering the last copy in this browser. */
export function useIgFeed(initial: IgFeed | null, limit = 300) {
  const [feed, setFeed] = useState<IgFeed | null>(initial);
  useEffect(() => {
    if (!initial) { const c = memory.get<IgFeed>("igfeed"); if (c) setFeed(c); }
    igApi.feed(limit).then((f) => { setFeed(f); memory.set("igfeed", { ...f, posts: f.posts.slice(0, 24) }); }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return feed;
}

function Tile({ p, onOpen }: { p: IgPost; onOpen: () => void }) {
  const img = p.thumb ?? p.src;
  return (
    <button className="igt" onClick={onOpen} aria-label={`Open post${p.caption ? `: ${p.caption.slice(0, 80)}` : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {img ? <img src={img} alt="" loading="lazy" /> : p.type === "video" && p.src ? <video src={p.src} muted playsInline preload="metadata" /> : null}
      <KindIcon type={p.type} />
      {p.caption && <span className="ov"><span>{p.caption}</span></span>}
    </button>
  );
}

function Lightbox({ feed, at, setAt }: { feed: IgFeed; at: number; setAt: (n: number | null) => void }) {
  const p = feed.posts[at];
  const [slide, setSlide] = useState(0);
  useEffect(() => { setSlide(0); }, [at]);
  const items = p.type === "album" && p.children.length ? p.children : [{ type: p.type === "video" ? "VIDEO" : "IMAGE", src: p.src, thumb: p.thumb }];
  const cur = items[Math.min(slide, items.length - 1)];
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAt(null);
      if (e.key === "ArrowRight") { if (slide < items.length - 1) setSlide(slide + 1); else if (at < feed.posts.length - 1) setAt(at + 1); }
      if (e.key === "ArrowLeft") { if (slide > 0) setSlide(slide - 1); else if (at > 0) setAt(at - 1); }
    };
    document.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", k); document.body.style.overflow = ""; };
  }, [at, slide, items.length, feed.posts.length, setAt]);

  return (
    <>
      <div className="scrim" onClick={() => setAt(null)} />
      <button className="icon-btn lb-close" onClick={() => setAt(null)} aria-label="Close"><Icon.x /></button>
      {at > 0 && <button className="lb-post prev" onClick={() => setAt(at - 1)} aria-label="Previous post">‹</button>}
      {at < feed.posts.length - 1 && <button className="lb-post next" onClick={() => setAt(at + 1)} aria-label="Next post">›</button>}
      <div className="lightbox" role="dialog" aria-modal="true" aria-label="Instagram post">
        <div className="stage">
          {cur.type === "VIDEO" && cur.src
            ? <video key={cur.src} src={cur.src} poster={cur.thumb ?? undefined} controls autoPlay playsInline />
            // eslint-disable-next-line @next/next/no-img-element
            : (cur.src ?? cur.thumb) ? <img src={(cur.src ?? cur.thumb)!} alt={p.caption?.slice(0, 120) ?? "Instagram post"} />
            : <a className="btn light" href={p.permalink} target="_blank" rel="noopener">Watch on Instagram</a>}
          {items.length > 1 && <>
            {slide > 0 && <button className="lb-nav prev" onClick={() => setSlide(slide - 1)} aria-label="Previous photo">‹</button>}
            {slide < items.length - 1 && <button className="lb-nav next" onClick={() => setSlide(slide + 1)} aria-label="Next photo">›</button>}
            <div className="lb-dots" aria-hidden="true">{items.map((_, k) => <span key={k} className={k === slide ? "on" : ""} />)}</div>
          </>}
        </div>
        <div className="lb-side">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <header><img src="/brand/monogram.png" alt="" /><a href={feed.url} target="_blank" rel="noopener" style={{ textDecoration: "none" }}>{feed.handle}</a></header>
          <div className="cap">{p.caption ?? ""}</div>
          <footer><span>{when(p.postedAt)}</span><a className="btn ghost sm" href={p.permalink} target="_blank" rel="noopener">View on Instagram</a></footer>
        </div>
      </div>
    </>
  );
}

/** The whole feed as a gallery (4 across on desktop, 3 on phones like Instagram itself). */
export function InstagramPage({ initial }: { initial: IgFeed | null }) {
  const { store } = useShop();
  const feed = useIgFeed(initial);
  const [at, setAt] = useState<number | null>(null);
  const [shown, setShown] = useState(24);
  if (!feed) return <main className="wrap"><div className="empty" style={{ marginTop: 40 }} role="status"><b>Loading our Instagram…</b></div></main>;
  const posts = feed.posts.slice(0, shown);
  return (
    <main className="wrap">
      <nav className="crumbs" aria-label="Breadcrumb"><Link href="/">Home</Link><span>/</span><span>Instagram</span></nav>
      <section className="igprof">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <div className="av"><span><img src="/brand/monogram.png" alt="" /></span></div>
        <div>
          <h1>@{feed.handle} <a className="btn sm" href={feed.url} target="_blank" rel="noopener">Follow on Instagram</a></h1>
          <div className="stats"><span><b>{feed.posts.length}</b> posts{feed.posts.length >= 300 ? "+" : ""}</span></div>
          <p>Tova-Ster: wellness for your whole self. New products, how-tos and offers, first on Instagram{store ? `. Shop everything you see at ${store.business.web}` : ""}.</p>
        </div>
      </section>
      {posts.length ? (
        <div className="iggal">{posts.map((p, k) => <Tile key={p.id} p={p} onOpen={() => setAt(k)} />)}</div>
      ) : (
        <div className="empty" style={{ margin: "32px 0" }}><b>New posts are on their way</b><p>Follow us on Instagram to see them first.</p><a className="btn sm" href={feed.url} target="_blank" rel="noopener">Open Instagram</a></div>
      )}
      {shown < feed.posts.length && <div style={{ display: "flex", justifyContent: "center", margin: "18px 0" }}><button className="btn ghost" onClick={() => setShown(shown + 24)}>Show more posts</button></div>}
      <div style={{ height: 40 }} />
      {at !== null && <Lightbox feed={{ ...feed, posts }} at={at} setAt={setAt} />}
    </main>
  );
}

/** Homepage strip: the latest posts, opening in the same viewer, with a link to the full gallery. */
export function InstagramStrip() {
  const { store } = useShop();
  const feed = useIgFeed(null, 24);
  const [at, setAt] = useState<number | null>(null);
  const count = Math.max(3, Math.min(12, store?.site.insta.homeCount ?? 6));
  if (!store?.site.insta.on || !feed || !feed.posts.length) return null;
  const posts = feed.posts.slice(0, count);
  return (
    <section className="sec"><div className="wrap">
      <div className="sec-head">
        <div><h2>Follow @{feed.handle}</h2><p>New products, how-tos and offers, first on Instagram.</p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Link className="btn ghost sm" href="/instagram">See all posts</Link><a className="btn sm" href={feed.url} target="_blank" rel="noopener">Follow</a></div>
      </div>
      <div className="iggal strip" style={{ ["--n" as string]: Math.min(count, 6) }}>
        {posts.map((p, k) => <Tile key={p.id} p={p} onOpen={() => setAt(k)} />)}
      </div>
      {at !== null && <Lightbox feed={{ ...feed, posts }} at={at} setAt={setAt} />}
    </div></section>
  );
}
