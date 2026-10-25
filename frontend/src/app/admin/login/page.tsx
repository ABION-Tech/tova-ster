"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminJson } from "../../../lib/backend";
import { Button } from "../../../components/ui/Button";
import { PasswordInput } from "../../../components/ui/PasswordInput";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await adminJson("/admin/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      router.push("/admin/products");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-5)", background: "var(--surface-2)" }}>
      <div className="card" style={{ width: "100%", maxWidth: 380, padding: "var(--space-6) var(--space-5)" }}>
        <p style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Tova-Ster</p>
        <h1 className="display-3" style={{ marginBottom: "var(--space-5)" }}>Admin sign in</h1>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <div>
            <label className="field-label" htmlFor="admin-email">Email</label>
            <input
              id="admin-email"
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
            />
          </div>
          <PasswordInput label="Password" required value={password} onChange={(e) => setPassword(e.target.value)} />

          {error && (
            <p style={{ fontSize: 13, color: "var(--danger-text)", background: "var(--danger-bg)", padding: "10px 12px", borderRadius: "var(--radius-sm)" }}>
              {error}
            </p>
          )}

          <Button type="submit" variant="primary" fullWidth disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <p style={{ marginTop: "var(--space-5)", fontSize: 12, color: "var(--ink-muted)", lineHeight: 1.6 }}>
          No admin account yet? Create one from the backend:
          <br />
          <code style={{ fontSize: 11, background: "var(--surface-2)", padding: "2px 5px", borderRadius: 3 }}>
            npm run create-admin -- --email=... --password=... --name=&quot;...&quot;
          </code>
        </p>
      </div>
    </main>
  );
}
