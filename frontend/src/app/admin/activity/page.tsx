"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { adminJson } from "../../../lib/backend";

interface Ev { id: string; type: string; message: string; created_at: string; user_id: string | null; admin_name: string | null; user_email: string | null }

const TYPES: [string, string][] = [
  ["", "Everything"], ["order", "Orders"], ["payment", "Payments"], ["dispatch", "Dispatch"], ["basket", "Basket"], ["checkout", "Checkout"],
  ["signup", "Sign-ups"], ["points", "Points"], ["review", "Reviews"], ["email", "Emails"], ["newsletter", "Newsletter"], ["birthday", "Birthdays"],
  ["subscription", "Subscriptions"], ["search", "Searches"], ["view", "Page views"], ["visit", "Visits"], ["quiz", "Quiz"], ["profile", "Profile"], ["admin", "Team"],
];
const when = (t: string) => new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });

export default function ActivityAdmin() {
  const [type, setType] = useState("");
  const [events, setEvents] = useState<Ev[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((t: string, before?: string) => {
    const qs = new URLSearchParams({ limit: "100" });
    if (t) qs.set("type", t);
    if (before) qs.set("before", before);
    adminJson<{ events: Ev[] }>(`/admin/activity?${qs}`)
      .then((d) => { setEvents((cur) => (before && cur ? [...cur, ...d.events] : d.events)); setMore(d.events.length === 100); setError(null); })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => { setEvents(null); load(type); }, [type, load]);
  // New events appear without reloading the page.
  useEffect(() => { const t = setInterval(() => { if (!document.hidden) load(type); }, 20000); return () => clearInterval(t); }, [type, load]);

  return (
    <>
      <div className="ahead">
        <div><h1>Activity</h1><p>Everything the shop records, newest first. Browsing is only recorded for visitors who accepted all cookies, and is deleted after the retention period.</p></div>
        <select className="ain" style={{ width: 200 }} value={type} onChange={(e) => setType(e.target.value)} aria-label="Show">
          {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      {error && <p className="note">Couldn&apos;t load activity: {error}</p>}
      <div className="acard">
        <div className="tbl-wrap"><table className="t">
          <thead><tr><th>When</th><th>Type</th><th>What happened</th><th>Who</th></tr></thead>
          <tbody>
            {!events ? <tr><td colSpan={4} className="muted">Loading…</td></tr>
              : events.length === 0 ? <tr><td colSpan={4} className="muted">Nothing recorded yet.</td></tr>
              : events.map((e) => (
                <tr key={e.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{when(e.created_at)}</td>
                  <td><span className="pill paused">{TYPES.find(([v]) => v === e.type)?.[1] ?? e.type}</span></td>
                  <td>{e.message}</td>
                  <td>{e.admin_name ? `${e.admin_name} (team)` : e.user_id ? <Link href={`/admin/customers/${e.user_id}`}>{e.user_email ?? "Customer"}</Link> : <span className="muted">Visitor</span>}</td>
                </tr>
              ))}
          </tbody>
        </table></div>
        {more && events && <div><button className="btn sm ghost" onClick={() => load(type, events[events.length - 1].id)}>Show older</button></div>}
      </div>
    </>
  );
}
