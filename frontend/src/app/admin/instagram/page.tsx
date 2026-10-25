"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { adminJson, BACKEND_URL } from "../../../lib/backend";

interface Status { connected: boolean; username: string | null; tokenExpiresAt: string | null; lastSyncAt: string | null; lastError: string | null; posts: number; hidden: number; oauthReady: boolean }
interface Post { id: string; media_type: string; thumbnail_url: string | null; media_url: string | null; permalink: string; caption: string | null; posted_at: string; hidden: boolean }

const when = (d: string | null) => (d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "never");
const NOTE: Record<string, string> = {
  connected: "Instagram is connected. Your posts are now on the shop.",
  denied: "The Instagram sign-in was cancelled, so nothing changed.",
  expired: "That sign-in link expired. Press Connect Instagram again.",
  setup: "The Instagram app details aren't set on the server yet. Follow the setup steps below.",
};

function InstagramAdmin() {
  const q = useSearchParams();
  const [data, setData] = useState<{ status: Status; media: Post[] } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => adminJson<{ status: Status; media: Post[] }>("/admin/instagram").then(setData).catch((e) => setMsg(e.message)), []);
  useEffect(() => {
    load();
    const ig = q.get("ig");
    if (ig) setMsg(ig === "failed" ? `Couldn't connect: ${q.get("m") ?? "please try again."}` : NOTE[ig] ?? null);
  }, [load, q]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg(ok); await load(); } catch (e) { setMsg(e instanceof Error ? e.message : "Something went wrong."); } finally { setBusy(false); }
  }

  if (!data) return <p>Loading…</p>;
  const s = data.status;
  return (
    <div style={{ display: "grid", gap: 20, maxWidth: 1100 }}>
      <h1>Instagram feed</h1>
      {msg && <div style={{ padding: 12, borderRadius: 8, background: "#F4EAD3" }} role="status">{msg}</div>}

      <section style={{ border: "1px solid #E2DFD9", borderRadius: 12, padding: 18, display: "grid", gap: 10 }}>
        <b>{s.connected ? `Connected: @${s.username ?? "…"}` : "Not connected"}</b>
        <span>Posts on the shop: {s.posts - s.hidden} of {s.posts}. Last sync: {when(s.lastSyncAt)}. {s.tokenExpiresAt ? `Access renews automatically (current key valid until ${when(s.tokenExpiresAt)}).` : ""}</span>
        {s.lastError && <span style={{ color: "#B42318" }}>Last problem: {s.lastError}</span>}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a className="btn" href={`${BACKEND_URL}/admin/instagram/connect`}>{s.connected ? "Reconnect Instagram" : "Connect Instagram"}</a>
          {s.connected && <button className="btn" disabled={busy} onClick={() => act(() => adminJson("/admin/instagram/sync", { method: "POST" }), "Synced with Instagram.")}>Sync now</button>}
          {s.connected && <button className="btn" disabled={busy} onClick={() => confirm("Disconnect Instagram? The shop will show your chosen pictures instead.") && act(() => adminJson("/admin/instagram/token", { method: "DELETE" }), "Disconnected.")}>Disconnect</button>}
        </div>
        <details>
          <summary>Have an access token instead? Paste it here</summary>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Instagram access token" style={{ flex: 1, padding: 8 }} />
            <button className="btn" disabled={busy || token.length < 20} onClick={() => act(() => adminJson("/admin/instagram/token", { method: "PUT", body: JSON.stringify({ token }) }).then(() => setToken("")), "Connected with the token.")}>Save</button>
          </div>
        </details>
      </section>

      {!s.oauthReady && (
        <section style={{ border: "1px solid #E2DFD9", borderRadius: 12, padding: 18 }}>
          <b>One-time setup (about 15 minutes)</b>
          <ol style={{ lineHeight: 1.7 }}>
            <li>In the Instagram app: Settings → Account type and tools → switch @tovaster1 to a <b>Business</b> or <b>Creator</b> account (free).</li>
            <li>At developers.facebook.com, create an app (type: <b>Business</b>) and add the <b>Instagram</b> product, choosing <b>API setup with Instagram business login</b>.</li>
            <li>Under Business login settings, add this redirect URL: <code>https://api.tova-ster.com/instagram/oauth/callback</code> (your Railway backend address).</li>
            <li>Copy the <b>Instagram app ID</b> and <b>Instagram app secret</b> into Railway as INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET, and set INSTAGRAM_REDIRECT_URI to the same redirect URL.</li>
            <li>Come back here and press <b>Connect Instagram</b>, then log in as @tovaster1 and approve.</li>
          </ol>
        </section>
      )}

      {data.media.length > 0 && (
        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
          {data.media.map((p) => (
            <div key={p.id} style={{ border: "1px solid #E2DFD9", borderRadius: 10, overflow: "hidden", opacity: p.hidden ? 0.45 : 1 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <a href={p.permalink} target="_blank" rel="noopener"><img src={p.thumbnail_url ?? p.media_url ?? ""} alt="" style={{ width: "100%", aspectRatio: "4 / 5", objectFit: "cover", display: "block" }} /></a>
              <div style={{ padding: 8, display: "grid", gap: 6, fontSize: 12 }}>
                <span>{p.media_type === "VIDEO" ? "Reel" : p.media_type === "CAROUSEL_ALBUM" ? "Carousel" : "Photo"} · {new Date(p.posted_at).toLocaleDateString("en-GB")}</span>
                <button className="btn" disabled={busy} onClick={() => act(() => adminJson(`/admin/instagram/media/${p.id}`, { method: "PATCH", body: JSON.stringify({ hidden: !p.hidden }) }), p.hidden ? "Post shown on the shop." : "Post hidden from the shop.")}>{p.hidden ? "Show on shop" : "Hide from shop"}</button>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<p>Loading…</p>}><InstagramAdmin /></Suspense>;
}
