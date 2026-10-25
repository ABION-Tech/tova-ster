"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useShop } from "../ShopProvider";
import { ReceiptView, Tracking } from "../ReceiptView";
import { orderApi } from "../../../lib/tova/api";
import type { Receipt } from "../../../lib/tova/types";

/**
 * Where Stripe sends the shopper back. We never trust the redirect itself:
 * the receipt only appears once the backend has verified the payment with
 * Stripe (webhook), so we poll briefly while that lands.
 */
export function Confirmation({ reference }: { reference: string | null }) {
  const { refreshCart, track, store } = useShop();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [state, setState] = useState<"waiting" | "slow" | "missing">("waiting");

  useEffect(() => {
    if (!reference) { setState("missing"); return; }
    let stop = false, tries = 0;
    const tick = async () => {
      tries++;
      try {
        const r = await orderApi.receiptByReference(reference);
        if (r.receipt) {
          setReceipt(r.receipt); refreshCart();
          track("order", `Order ${r.receipt.orderNumber} confirmed`, { orderNumber: r.receipt.orderNumber });
          return;
        }
      } catch { if (tries > 3) { setState("missing"); return; } }
      if (tries === 10) setState("slow");
      if (!stop && tries < 40) setTimeout(tick, tries < 10 ? 1500 : 4000);
    };
    tick();
    return () => { stop = true; };
  }, [reference]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!receipt) return (
    <main className="wrap" style={{ maxWidth: 820 }}>
      <div className="empty" style={{ marginTop: 40 }} role="status">
        {state === "missing" ? <>
          <b>We couldn&apos;t find that payment</b>
          <p>If you were charged, your receipt is on its way by email. Questions? Email info@tova-ster.com.</p>
          <Link className="btn sm" href="/shop">Back to the shop</Link>
        </> : <>
          <b>Confirming your payment…</b>
          <p>{state === "slow" ? "This is taking a little longer than usual. You can leave this page; we'll email your receipt as soon as the payment is confirmed." : "This only takes a moment. Please don't pay again."}</p>
        </>}
      </div>
    </main>
  );

  const held = receipt.stage === "held";
  return (
    <main className="wrap" style={{ maxWidth: 820 }}>
      <div style={{ padding: "32px 0 8px", display: "grid", gap: 8 }}>
        <span className="pill active" style={{ justifySelf: "start" }}>Order confirmed</span>
        <h1 className="page-title" style={{ padding: 0 }}>Thank you, your order is confirmed</h1>
        <p style={{ color: "var(--ink-2)" }}>We&apos;ve emailed this receipt to {receipt.customer.email}. {held ? "We're giving your order a quick check before it's sent." : "We'll email you a tracking link when it's on its way."}</p>
      </div>
      <Tracking r={receipt} />
      <ReceiptView r={receipt} vatRate={store?.delivery.vat} />
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "16px 0 48px" }}>
        <button className="btn ghost" onClick={() => window.print()}>Print or save as PDF</button>
        <Link className="btn" href="/account">Go to my account</Link>
        <Link className="btn ghost" href="/shop">Keep shopping</Link>
      </div>
    </main>
  );
}

/** Local/staging only: stands in for Stripe's payment page until live keys are added. */
export function TestPay({ reference }: { reference: string | null }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <main className="wrap" style={{ maxWidth: 560 }}>
      <div className="panel" style={{ marginTop: 40, gap: 14 }}>
        <span className="tag dark" style={{ justifySelf: "start" }}>Test mode</span>
        <h1 className="page-title" style={{ padding: 0 }}>Test payment</h1>
        <p>This page stands in for Stripe while the shop is in test mode. No money moves. In the live shop customers pay on Stripe&apos;s secure page.</p>
        {err && <div className="notice warn">{err}</div>}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn" disabled={busy || !reference} onClick={async () => {
            setBusy(true);
            try { await orderApi.testPay(reference!); window.location.assign(`/checkout/callback?reference=${encodeURIComponent(reference!)}`); }
            catch (e) { setErr(e instanceof Error ? e.message : "Test payment failed."); setBusy(false); }
          }}>Pay (test)</button>
          <Link className="btn ghost" href="/checkout?cancelled=1">Cancel</Link>
        </div>
      </div>
    </main>
  );
}
