"use client";

import { useCallback, useEffect, useState } from "react";
import { adminJson } from "../../../lib/backend";
import type { AdminRole } from "../../../lib/admin/AdminContext";

interface Member {
  id: string; name: string; email: string; role: AdminRole; active: boolean; has_password: boolean;
  last_login_at: string | null; created_at: string; invite_expires_at: string | null;
}
interface Team { team: Member[]; roles: AdminRole[]; me: string }
interface InviteResult { inviteLink: string; expiresAt: string; emailed: boolean }

const ROLE_HELP: Record<AdminRole, string> = {
  Owner: "Everything, including the team and business settings.",
  Manager: "Runs the shop: products, prices, offers, homepage, emails, reports.",
  Support: "Sees orders, baskets and activity; approves reviews.",
  Packer: "Sees orders to pack; marks them packed, dispatched, delivered; updates stock.",
};
const box: React.CSSProperties = { border: "1px solid #E2DFD9", borderRadius: 12, padding: 18, display: "grid", gap: 12, background: "#fff" };
const inp: React.CSSProperties = { padding: 8, border: "1px solid #D5D1CA", borderRadius: 8, font: "inherit" };
const when = (t: string | null) => (t ? new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Never");

export default function TeamAdmin() {
  const [data, setData] = useState<Team | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [link, setLink] = useState<{ who: string; r: InviteResult } | null>(null);
  const [form, setForm] = useState({ name: "", email: "", role: "Packer" as AdminRole });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { adminJson<Team>("/admin/team").then(setData).catch((e) => setMsg(e.message)); }, []);
  useEffect(() => { load(); }, [load]);

  async function act(fn: () => Promise<void>) {
    setBusy(true); setMsg(null);
    try { await fn(); load(); } catch (e) { setMsg(e instanceof Error ? e.message : "Something went wrong."); } finally { setBusy(false); }
  }

  const invite = (e: React.FormEvent) => { e.preventDefault(); act(async () => {
    const r = await adminJson<InviteResult>("/admin/team", { method: "POST", body: JSON.stringify(form) });
    setLink({ who: form.name, r }); setForm({ name: "", email: "", role: "Packer" });
  }); };
  const newLink = (m: Member) => act(async () => {
    const r = await adminJson<InviteResult>(`/admin/team/${m.id}/invite`, { method: "POST" });
    setLink({ who: m.name, r });
  });
  const setRole = (m: Member, role: AdminRole) => act(async () => {
    await adminJson(`/admin/team/${m.id}`, { method: "PATCH", body: JSON.stringify({ role }) });
    setMsg(`${m.name} is now ${role}.`);
  });
  const remove = (m: Member) => { if (confirm(`Remove ${m.name} from the team? They are signed out straight away.`)) act(async () => {
    await adminJson(`/admin/team/${m.id}`, { method: "DELETE" });
    setMsg(`${m.name} was removed and signed out.`);
  }); };

  if (!data) return <p>{msg ?? "Loading…"}</p>;
  const active = data.team.filter((m) => m.active);
  const removed = data.team.filter((m) => !m.active);

  return (
    <div style={{ display: "grid", gap: 20, maxWidth: 1000 }}>
      <h1 style={{ margin: 0 }}>Team</h1>
      {msg && <div style={{ padding: 12, borderRadius: 8, background: "#F4EAD3" }} role="status">{msg}</div>}
      {link && (
        <div style={{ ...box, borderColor: "#B8912B" }} role="status">
          <b>Password link for {link.who}</b>
          <span style={{ fontSize: 13 }}>
            {link.r.emailed ? "We emailed this link. " : "Emails aren't switched on yet, so send this link yourself (for example by WhatsApp). "}
            It works once and expires {when(link.r.expiresAt)}.
          </span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input style={{ ...inp, flex: 1, minWidth: 260 }} readOnly value={link.r.inviteLink} onFocus={(e) => e.currentTarget.select()} />
            <button className="btn" onClick={() => navigator.clipboard?.writeText(link.r.inviteLink).then(() => setMsg("Link copied."))}>Copy link</button>
            <button className="btn" onClick={() => setLink(null)}>Done</button>
          </div>
        </div>
      )}

      <section style={box}>
        <b>Invite someone</b>
        <form onSubmit={invite} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, alignItems: "end" }}>
          <label style={{ display: "grid", gap: 4, fontSize: 13 }}>Name<input style={inp} required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label style={{ display: "grid", gap: 4, fontSize: 13 }}>Email<input style={inp} required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label style={{ display: "grid", gap: 4, fontSize: 13 }}>Role
            <select style={inp} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as AdminRole })}>
              {data.roles.map((r) => <option key={r}>{r}</option>)}
            </select></label>
          <button className="btn" disabled={busy}>Send invite</button>
        </form>
        <span style={{ fontSize: 13, color: "#6E685E" }}>{form.role}: {ROLE_HELP[form.role]}</span>
      </section>

      <section style={box}>
        <b>People with access ({active.length})</b>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ textAlign: "left", color: "#6E685E" }}>
              <th style={{ padding: 6 }}>Person</th><th style={{ padding: 6 }}>Role</th><th style={{ padding: 6 }}>Status</th><th style={{ padding: 6 }}>Last sign-in</th><th style={{ padding: 6 }} />
            </tr></thead>
            <tbody>{active.map((m) => (
              <tr key={m.id} style={{ borderTop: "1px solid #EEE" }}>
                <td style={{ padding: 6 }}>{m.name}{m.id === data.me ? " (you)" : ""}<br /><span style={{ color: "#6E685E" }}>{m.email}</span></td>
                <td style={{ padding: 6 }}>
                  <select style={inp} value={m.role} disabled={busy} onChange={(e) => setRole(m, e.target.value as AdminRole)} aria-label={`Role for ${m.name}`}>
                    {data.roles.map((r) => <option key={r}>{r}</option>)}
                  </select>
                </td>
                <td style={{ padding: 6 }}>{m.has_password ? "Active" : m.invite_expires_at ? `Invited, link valid until ${when(m.invite_expires_at)}` : "Invited, link expired"}</td>
                <td style={{ padding: 6 }}>{when(m.last_login_at)}</td>
                <td style={{ padding: 6, whiteSpace: "nowrap" }}>
                  <button className="btn" disabled={busy} onClick={() => newLink(m)}>{m.has_password ? "Reset password" : "New link"}</button>{" "}
                  <button className="btn" disabled={busy} onClick={() => remove(m)}>Remove</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <span style={{ fontSize: 13, color: "#6E685E" }}>The shop always keeps at least one Owner. Role changes and removals take effect straight away and are recorded in the activity log.</span>
      </section>

      {removed.length > 0 && (
        <section style={box}>
          <b>Removed ({removed.length})</b>
          <span style={{ fontSize: 13, color: "#6E685E" }}>{removed.map((m) => `${m.name} (${m.email})`).join(", ")}. To bring someone back, invite them again with the same email.</span>
        </section>
      )}
    </div>
  );
}
