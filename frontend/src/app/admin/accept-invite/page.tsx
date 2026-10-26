"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { adminJson } from "../../../lib/backend";
import { Button } from "../../../components/ui/Button";
import { PasswordInput } from "../../../components/ui/PasswordInput";

const MIN = 12;

function AcceptInvite() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [who, setWho] = useState<{ name: string; email: string; role: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) { setError("This link is incomplete. Ask the owner for a new one."); return; }
    adminJson<{ name: string; email: string; role: string }>(`/admin/auth/invite?token=${encodeURIComponent(token)}`)
      .then(setWho).catch((e) => setError(e.message));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < MIN) return setError(`Use at least ${MIN} characters.`);
    if (pw !== pw2) return setError("The two passwords don't match.");
    setBusy(true); setError(null);
    try {
      await adminJson("/admin/auth/accept-invite", { method: "POST", body: JSON.stringify({ token, password: pw }) });
      router.push("/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save your password.");
    } finally { setBusy(false); }
  }

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-5)", background: "var(--surface-2)" }}>
      <div className="card" style={{ width: "100%", maxWidth: 400, padding: "var(--space-6) var(--space-5)" }}>
        <p style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Tova-Ster</p>
        <h1 className="display-3" style={{ marginBottom: "var(--space-4)" }}>Choose your password</h1>
        {who && <p style={{ fontSize: 14, marginBottom: "var(--space-4)" }}>Welcome, {who.name}. You&apos;re joining the admin as <b>{who.role}</b> ({who.email}).</p>}
        {who && (
          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            <PasswordInput label={`Password (at least ${MIN} characters)`} required value={pw} onChange={(e) => setPw(e.target.value)} />
            <PasswordInput label="Type it again" required value={pw2} onChange={(e) => setPw2(e.target.value)} />
            <Button type="submit" variant="primary" fullWidth disabled={busy}>{busy ? "Saving…" : "Save and sign in"}</Button>
          </form>
        )}
        {error && <p style={{ fontSize: 13, color: "var(--danger-text)", background: "var(--danger-bg)", padding: "10px 12px", borderRadius: "var(--radius-sm)", marginTop: 12 }}>{error}</p>}
      </div>
    </main>
  );
}

export default function AcceptInvitePage() {
  return <Suspense fallback={null}><AcceptInvite /></Suspense>;
}
