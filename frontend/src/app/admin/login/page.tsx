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
      router.push("/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="adminlogin">
      <div className="card">
        <div className="brandrow">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/brand/monogram.png" alt="" /><b>Tova-Ster</b></div>
        <h1>Admin sign in</h1>

        <form onSubmit={handleSubmit}>
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
            <p className="error">
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
