"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../../../lib/tova/api";

/** Landing page for the unsubscribe link in marketing emails. Asks to confirm, so link scanners can't unsubscribe anyone. */
export function Unsubscribe() {
  const t = useSearchParams().get("t") ?? "";
  const [email, setEmail] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ask" | "busy" | "done" | "bad">("loading");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!t) { setState("bad"); return; }
    api<{ email: string }>(`/unsubscribe?t=${encodeURIComponent(t)}`)
      .then((d) => { setEmail(d.email); setState("ask"); })
      .catch(() => setState("bad"));
  }, [t]);

  async function go() {
    setState("busy"); setErr(null);
    try { await api("/unsubscribe", { method: "POST", json: { t } }); setState("done"); }
    catch (e) { setErr(e instanceof Error ? e.message : "Something went wrong. Please try again."); setState("ask"); }
  }

  return (
    <main className="wrap" style={{ maxWidth: 560, paddingBottom: 60 }}>
      <h1 className="page-title">Unsubscribe</h1>
      {state === "loading" && <p className="muted">One moment…</p>}
      {state === "bad" && <p>This link isn&apos;t valid. Please email <a href="mailto:info@tova-ster.com">info@tova-ster.com</a> and we&apos;ll take you off the list.</p>}
      {(state === "ask" || state === "busy") && (
        <>
          <p>Stop marketing emails to <b>{email}</b>? That includes offers, the newsletter and the birthday email. You&apos;ll still get emails about your orders.</p>
          {err && <p role="alert" style={{ color: "var(--sale)" }}>{err}</p>}
          <button className="btn" disabled={state === "busy"} onClick={go}>{state === "busy" ? "Unsubscribing…" : "Unsubscribe"}</button>
        </>
      )}
      {state === "done" && (
        <div role="status">
          <p>Done. <b>{email}</b> won&apos;t get marketing emails from us any more. It can take a day for anything already on its way.</p>
          <p className="muted">Changed your mind? You can sign up again at the bottom of any page.</p>
          <Link href="/" className="btn">Back to the shop</Link>
        </div>
      )}
    </main>
  );
}
