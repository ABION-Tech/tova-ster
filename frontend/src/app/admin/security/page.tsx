"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { adminJson } from "../../../lib/backend";

interface Status { enabled: boolean; required: boolean; recoveryLeft: number }
interface Setup { secret: string; uri: string; qrSvg: string }

function Security() {
  const router = useRouter();
  const usedRecovery = useSearchParams().get("recovery") === "1";
  const [st, setSt] = useState<Status | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { adminJson<Status>("/admin/auth/2fa").then(setSt).catch((e: Error) => setMsg(e.message)); }, []);
  useEffect(() => { load(); }, [load]);

  async function start() {
    setBusy(true); setMsg(null);
    try { setSetup(await adminJson<Setup>("/admin/auth/2fa/setup", { method: "POST" })); setCode(""); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't start."); } finally { setBusy(false); }
  }
  async function confirm(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      const r = await adminJson<{ recoveryCodes: string[] }>("/admin/auth/2fa/confirm", { method: "POST", body: JSON.stringify({ code }) });
      setCodes(r.recoveryCodes); setSetup(null); load();
    } catch (err) { setMsg(err instanceof Error ? err.message : "That code didn't match."); } finally { setBusy(false); }
  }
  async function turnOff() {
    const c = prompt("Enter a current code from your app to turn two-step sign-in off:");
    if (!c) return;
    try { await adminJson("/admin/auth/2fa/off", { method: "POST", body: JSON.stringify({ code: c }) }); setMsg("Two-step sign-in is off."); load(); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't turn it off."); }
  }

  if (!st) return <p className="muted">{msg ?? "Loading…"}</p>;

  return (
    <>
      <div className="ahead">
        <div><h1>Two-step sign-in</h1><p>After your password, a 6-digit code from an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, 1Password and similar).</p></div>
      </div>
      {st.required && !st.enabled && !codes && <p className="note">The team signs in with two steps. Set it up now to use the admin; it takes about a minute.</p>}
      {usedRecovery && <p className="note">You signed in with a recovery code, and that code no longer works. If you&apos;ve lost your phone, set two-step up again on your new phone below.</p>}
      {msg && <p className="note" role="status">{msg}</p>}

      {codes && (
        <div className="acard" style={{ borderColor: "var(--gold)" }}>
          <h2>Save your recovery codes</h2>
          <p className="sub">If you lose your phone, each of these lets you sign in once. Keep them somewhere safe (a password manager, or printed). They won&apos;t be shown again.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 16 }}>
            {codes.map((c) => <span key={c} style={{ padding: "8px 10px", background: "var(--surface)", borderRadius: 8 }}>{c}</span>)}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn sm" onClick={() => navigator.clipboard?.writeText(codes.join("\n")).then(() => setMsg("Recovery codes copied."))}>Copy codes</button>
            <button className="btn sm ghost" onClick={() => { setCodes(null); window.location.assign("/admin"); }}>I&apos;ve saved them</button>
          </div>
        </div>
      )}

      {!codes && (
        <div className="acard">
          <h2>{st.enabled ? "On" : "Not set up yet"}</h2>
          {st.enabled ? (
            <>
              <p className="sub">{st.recoveryLeft} of 8 recovery codes left.</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn sm" disabled={busy} onClick={start}>Move to a new phone</button>
                {!st.required && <button className="btn sm ghost" onClick={turnOff}>Turn off</button>}
              </div>
            </>
          ) : !setup ? (
            <div><button className="btn sm" disabled={busy} onClick={start}>Set up two-step sign-in</button></div>
          ) : null}

          {setup && (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 220px) 1fr", gap: 20, alignItems: "start" }} className="setup2fa">
              <div style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 12, padding: 10 }} aria-label="QR code for your authenticator app"
                dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
              <div style={{ display: "grid", gap: 12 }}>
                <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6, fontSize: 14 }}>
                  <li>In your authenticator app, add an account and scan this QR code.</li>
                  <li>Can&apos;t scan? Type this key instead: <code style={{ background: "var(--surface)", padding: "2px 6px", borderRadius: 6, wordBreak: "break-all" }}>{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</code></li>
                  <li>Enter the 6-digit code the app shows.</li>
                </ol>
                <form onSubmit={confirm} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input className="ain" style={{ width: 160, fontSize: 18, letterSpacing: ".2em" }} inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                    required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" aria-label="6-digit code" autoFocus />
                  <button className="btn sm" disabled={busy || code.length !== 6}>Turn on</button>
                  <button type="button" className="btn sm ghost" onClick={() => setSetup(null)}>Cancel</button>
                </form>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export default function SecurityPage() {
  return <Suspense fallback={null}><Security /></Suspense>;
}
