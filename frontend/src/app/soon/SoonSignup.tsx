"use client";
import { useState } from "react";
import { api, ApiError } from "../../lib/tova/api";

export function SoonSignup() {
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!consent) { setError("Please tick the box so we can email you."); return; }
    setState("busy");
    try {
      await api<void>("/newsletter", { method: "POST", json: { email, consent: true, source: "coming_soon" } });
      setState("done");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setState("idle");
    }
  }

  if (state === "done") return <p className="soon-done" role="status">You&rsquo;re on the list. We&rsquo;ll email you when the shop opens.</p>;
  return (
    <form className="soon-form" onSubmit={submit} noValidate>
      <label className="sr" htmlFor="soon-email">Email address</label>
      <div className="soon-row">
        <input id="soon-email" type="email" autoComplete="email" required placeholder="Your email address" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="btn" type="submit" disabled={state === "busy"}>{state === "busy" ? "Joining…" : "Tell me when it opens"}</button>
      </div>
      <label className="soon-consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>Email me about the launch, offers and new products. Unsubscribe any time.</span>
      </label>
      {error && <p className="soon-error" role="alert">{error}</p>}
    </form>
  );
}
