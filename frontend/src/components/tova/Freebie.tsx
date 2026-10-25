"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useShop } from "./ShopProvider";
import { Icon } from "./Icons";
import { MediaView } from "./ProductArt";
import { freebieApi } from "../../lib/tova/api";
import { memory } from "../../lib/tova/memory";

type FreebieMemory = { got?: boolean; dismissedAt?: number };

/** The free guide offer: email + consent in, guide (and optional welcome code) out. */
export function FreebieOffer({ where, onDone, compact }: { where: string; onDone?: () => void; compact?: boolean }) {
  const { store, track } = useShop();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ url: string; code: string | null; pct: number | null } | null>(null);
  const fb = store?.features.freebie;
  if (!fb?.on) return null;

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const r = await freebieApi.claim(email, where);
      setDone({ url: r.downloadUrl, code: r.code, pct: r.pct });
      memory.set("freebie", { got: true } satisfies FreebieMemory);
      track("newsletter", `Got the free guide (${where})`);
      onDone?.();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Please try again."); }
    finally { setBusy(false); }
  }

  return (
    <div className="freebie">
      <div className="cover" aria-hidden="true">
        {fb.cover && <MediaView media={fb.cover} />}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <div className="doc"><div><img src="/brand/monogram.png" alt="" style={{ width: 22, position: "static" }} /></div><div><small>FREE GUIDE</small><br /><b>Your UK winter vitamin plan</b></div></div>
      </div>
      <div>
        <h2 id={`fb-${where}`}>{fb.title}</h2>
        <p style={{ marginTop: 8 }}>{fb.text}</p>
        {done ? (
          <div className="done" role="status">
            <div className="notice good" style={{ justifySelf: "stretch" }}>Done. It&apos;s on its way to {email}, and you can download it now.</div>
            <a className="btn" href={done.url} download target="_blank" rel="noopener">Download the guide (PDF)</a>
            {done.code && <p>As a thank you: <span className="codechip">{done.code}</span> for {done.pct}% off your first order.</p>}
          </div>
        ) : (
          <form onSubmit={submit} aria-labelledby={`fb-${where}`}>
            <label className="sr" htmlFor={`fbe-${where}`}>Email address</label>
            <input id={`fbe-${where}`} type="email" required autoComplete="email" placeholder="Your email address" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="btn" type="submit" disabled={busy}>{busy ? "Sending…" : fb.button}</button>
            <label className="consent"><input type="checkbox" required /> <span>Send me the guide, plus Tova-Ster news and offers by email. I&apos;m 18 or over and can unsubscribe any time.</span></label>
            {err && <p className="formerr" role="alert" style={{ gridColumn: "1 / -1" }}>{err}</p>}
          </form>
        )}
        {!compact && !done && fb.giveCode && store?.features.welcome.on && <p style={{ fontSize: 13, marginTop: 10 }}>Plus {store.features.welcome.pct}% off your first order.</p>}
      </div>
    </div>
  );
}

const QUIET = ["/checkout", "/account"];

/** Pop-up version: after a while browsing, or when a desktop visitor heads for the address bar. */
export function FreebiePopup() {
  const { store, consent, drawer, menu } = useShop();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const shown = useRef(false);
  const fb = store?.features.freebie;

  useEffect(() => {
    if (!fb?.on || !fb.popup || shown.current) return;
    const m = memory.get<FreebieMemory>("freebie") ?? {};
    if (m.got) return;
    if (m.dismissedAt && Date.now() - m.dismissedAt < fb.remindDays * 86400000) return;
    try { if (sessionStorage.getItem("tova:fbseen")) return; } catch { /* ignore */ }

    const ok = () => !shown.current && !QUIET.some((q) => location.pathname.startsWith(q));
    const show = () => {
      if (!ok()) return;
      shown.current = true; setOpen(true);
      try { sessionStorage.setItem("tova:fbseen", "1"); } catch { /* ignore */ }
    };
    const t = setTimeout(show, Math.max(5, fb.delaySec) * 1000);
    const armedAt = Date.now();
    const exit = (e: MouseEvent) => { if (fb.exitIntent && e.clientY <= 0 && !e.relatedTarget && Date.now() - armedAt > 8000) show(); };
    if (matchMedia("(pointer: fine)").matches) document.addEventListener("mouseout", exit);
    return () => { clearTimeout(t); document.removeEventListener("mouseout", exit); };
  }, [fb?.on, fb?.popup, fb?.delaySec, fb?.exitIntent, fb?.remindDays]);

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function dismiss() {
    setOpen(false);
    const m = memory.get<FreebieMemory>("freebie") ?? {};
    if (!m.got) memory.set("freebie", { dismissedAt: Date.now() } satisfies FreebieMemory);
  }

  // Never on top of the cookie choice, the basket, the menu, or the quiet pages.
  if (!open || !fb || consent === null || drawer || menu || QUIET.some((q) => path.startsWith(q))) return null;
  return (
    <>
      <div className="scrim" onClick={dismiss} />
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="fb-popup">
        <button className="icon-btn x" onClick={dismiss} aria-label="Close"><Icon.x /></button>
        <FreebieOffer where="popup" compact onDone={() => { /* stay open to show the download */ }} />
        <div style={{ padding: "0 32px 22px", marginTop: -10 }}><button className="nothanks" onClick={dismiss}>No thanks</button></div>
      </div>
    </>
  );
}
