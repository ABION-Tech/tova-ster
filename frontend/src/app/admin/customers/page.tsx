"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { adminJson } from "../../../lib/backend";
import { gbp } from "../../../lib/admin/status";

interface Row {
  id: string; email: string; first_name: string; last_name: string; created_at: string;
  points_balance: number; marketing_email: boolean; orders: number; spent: number; last_order_at: string | null;
}

const date = (t: string | null) => (t ? new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "No orders");

export default function CustomersAdmin() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function load(term: string) {
    adminJson<{ customers: Row[]; total: number }>(`/admin/customers?q=${encodeURIComponent(term)}`)
      .then((d) => { setRows(d.customers); setTotal(d.total); setError(null); })
      .catch((e: Error) => setError(e.message));
  }
  useEffect(() => { load(""); }, []);

  return (
    <>
      <div className="ahead">
        <div><h1>Customers</h1><p>{total} customer account{total === 1 ? "" : "s"}. Guests who checked out without an account are on their orders.</p></div>
        <input type="search" className="ain wide" style={{ maxWidth: 300 }} placeholder="Name, email or phone" value={q} aria-label="Search customers"
          onChange={(e) => { const v = e.target.value; setQ(v); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => load(v), 300); }} />
      </div>
      {error && <p className="note">Couldn&apos;t load customers: {error}</p>}
      <div className="acard">
        <div className="tbl-wrap">
          <table className="t">
            <thead><tr><th>Customer</th><th>Joined</th><th className="r">Orders</th><th className="r">Spent</th><th>Last order</th><th className="r">Points</th><th>Emails</th></tr></thead>
            <tbody>
              {!rows ? <tr><td colSpan={7} className="muted">Loading…</td></tr>
                : rows.length === 0 ? <tr><td colSpan={7} className="muted">No customers match.</td></tr>
                : rows.map((c) => (
                  <tr key={c.id} className="click" onClick={() => router.push(`/admin/customers/${c.id}`)}>
                    <td><Link href={`/admin/customers/${c.id}`} onClick={(e) => e.stopPropagation()}><b>{c.first_name} {c.last_name}</b></Link><br /><span className="muted">{c.email}</span></td>
                    <td>{date(c.created_at)}</td>
                    <td className="r">{c.orders}</td>
                    <td className="r">{gbp(c.spent)}</td>
                    <td>{date(c.last_order_at)}</td>
                    <td className="r">{c.points_balance}</td>
                    <td>{c.marketing_email ? <span className="pill active">Yes</span> : <span className="pill paused">No</span>}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
