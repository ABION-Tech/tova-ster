"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminJson } from "../../../lib/backend";
import { Button } from "../../../components/ui/Button";
import { PasswordInput } from "../../../components/ui/PasswordInput";

interface LoginReply { needsCode?: boolean; ticket?: string; setupTwoStep?: boolean }

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [ticket, setTicket] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setLoading(true);
    try {
      const r = await adminJson<LoginReply>("/admin/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      if (r.needsCode && r.ticket) { setTicket(r.ticket); setPassword(""); return; }
      router.push(r.setupTwoStep ? "/admin/security" : "/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally { setLoading(false); }
  }

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setLoading(true);
    try {
      const r = await adminJson<{ usedRecovery?: boolean }>("/admin/auth/verify-code", { method: "POST", body: JSON.stringify({ ticket, code }) });
      router.push(r.usedRecovery ? "/admin/security?recovery=1" : "/admin");
    } catch (err) {
      const m = err instanceof Error ? err.message : "That code didn't match.";
      setError(m);
      if (/too long|too many/i.test(m)) { setTicket(null); setCode(""); }
    } finally { setLoading(false); }
  }

  return (
    <main className="adminlogin">
      <div className="card">
        <div className="brandrow">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/brand/monogram.png" alt="" /><b>Tova-Ster</b></div>
        {!ticket ? (
          <>
            <h1>Admin sign in</h1>
            <form onSubmit={signIn}>
              <div>
                <label className="field-label" htmlFor="admin-email">Email</label>
                <input id="admin-email" type="email" required autoFocus autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
              </div>
              <PasswordInput label="Password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              {error && <p className="error">{error}</p>}
              <Button type="submit" variant="primary" fullWidth disabled={loading}>{loading ? "Signing in…" : "Sign in"}</Button>
            </form>
            <p style={{ marginTop: 18, fontSize: 13, color: "var(--ink-2)" }}>New to the team? Use the invite link the owner sent you.</p>
          </>
        ) : (
          <>
            <h1>Enter your code</h1>
            <p style={{ fontSize: 14, color: "var(--ink-2)", margin: "0 0 14px" }}>Open your authenticator app and type the 6-digit code for Tova-Ster. Lost your phone? Use one of your recovery codes.</p>
            <form onSubmit={sendCode}>
              <div>
                <label className="field-label" htmlFor="admin-code">Code</label>
                <input id="admin-code" className="input" required autoFocus inputMode="text" autoComplete="one-time-code" maxLength={11}
                  value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" style={{ letterSpacing: ".2em", fontSize: 20 }} />
              </div>
              {error && <p className="error">{error}</p>}
              <Button type="submit" variant="primary" fullWidth disabled={loading}>{loading ? "Checking…" : "Continue"}</Button>
              <button type="button" className="btn ghost block" onClick={() => { setTicket(null); setCode(""); setError(null); }}>Back</button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
