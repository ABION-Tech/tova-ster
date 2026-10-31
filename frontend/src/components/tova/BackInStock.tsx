"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/tova/api";
import { useShop } from "./ShopProvider";

/** "Tell me when it's back" for a sold-out product: one email when it returns. */
export function BackInStock({ slug, name }: { slug: string; name: string }) {
  const { user } = useShop();
  const [email, setEmail] = useState(user?.email ?? "");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState("busy"); setErr(null);
    try { await api(`/products/${encodeURIComponent(slug)}/notify`, { method: "POST", json: { email } }); setState("done"); }
    catch (x) { setErr(x instanceof Error ? x.message : "Something went wrong."); setState("idle"); }
  }

  if (state === "done") return <div className="notice good" role="status">Thanks. We&apos;ll email you once when {name} is back in stock.</div>;
  return (
    <form onSubmit={submit} className="notice gold" style={{ display: "grid", gap: 8 }} aria-label="Tell me when it's back">
      <b>Tell me when it&apos;s back</b>
      <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Your email" aria-label="Your email"
          style={{ flex: "1 1 200px", minHeight: 42, border: "1px solid var(--line)", borderRadius: 10, padding: "0 12px", font: "inherit", background: "#fff" }} />
        <button className="btn" disabled={state === "busy"}>{state === "busy" ? "Saving…" : "Email me"}</button>
      </span>
      {err && <span role="alert" style={{ color: "var(--sale)" }}>{err}</span>}
      <small style={{ color: "var(--ink-2)" }}>One email when it&apos;s back, nothing else.</small>
    </form>
  );
}
