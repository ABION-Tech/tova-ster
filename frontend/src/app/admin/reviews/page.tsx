"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { adminJson } from "../../../lib/backend";

interface AdminReview {
  id: string; productId: string; productName: string; productSlug: string; userId: string; reviewerName: string;
  rating: number; title: string | null; body: string | null; status: string; verifiedPurchase: boolean; createdAt: string;
}

const TABS: [string, string][] = [["all", "All"], ["approved", "Showing"], ["rejected", "Hidden"]];

export default function AdminReviewsPage() {
  const [reviews, setReviews] = useState<AdminReview[] | null>(null);
  const [total, setTotal] = useState(0);
  const [tab, setTab] = useState("all");
  const [msg, setMsg] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    setReviews(null);
    adminJson<{ reviews: AdminReview[]; total: number }>(`/admin/reviews?status=${tab}&limit=100`)
      .then((d) => { setReviews(d.reviews); setTotal(d.total); })
      .catch((e: Error) => setMsg(e.message));
  }, [tab]);

  async function setStatus(r: AdminReview, status: "approved" | "rejected") {
    setUpdating(r.id); setMsg(null);
    try {
      await adminJson(`/admin/reviews/${r.id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      setReviews((prev) => prev?.map((x) => (x.id === r.id ? { ...x, status } : x)) ?? null);
      setMsg(status === "approved" ? `${r.reviewerName}'s review is showing again.` : `${r.reviewerName}'s review is hidden from the shop.`);
    } catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't update."); } finally { setUpdating(null); }
  }

  return (
    <>
      <div className="ahead">
        <div><h1>Reviews</h1><p>Only customers whose order was delivered can review, so every review is from a real buyer. Reviews show straight away; hide any that break the rules (offensive, personal details, or health claims).</p></div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }} role="tablist">
        {TABS.map(([v, l]) => <button key={v} role="tab" aria-selected={tab === v} className={`btn sm${tab === v ? "" : " ghost"}`} onClick={() => setTab(v)}>{l}</button>)}
        <span className="muted">{total} review{total === 1 ? "" : "s"}</span>
      </div>
      {msg && <p className="note" role="status">{msg}</p>}

      {!reviews ? <p className="muted">Loading…</p> : reviews.length === 0 ? <div className="acard"><p className="muted">No reviews here yet.</p></div> : (
        <div style={{ display: "grid", gap: 12 }}>
          {reviews.map((r) => (
            <div key={r.id} className="acard" style={{ opacity: r.status === "rejected" ? 0.7 : 1 }}>
              <div className="ahead">
                <div>
                  <span style={{ color: "var(--gold)", fontSize: 16, letterSpacing: 2 }} aria-label={`${r.rating} out of 5 stars`}>{"★".repeat(r.rating)}<span style={{ color: "var(--line)" }}>{"★".repeat(5 - r.rating)}</span></span>
                  <p style={{ margin: "2px 0 0", fontSize: 14 }}>
                    <b>{r.reviewerName}</b>{r.verifiedPurchase && <span className="pill active" style={{ marginLeft: 8 }}>Verified buyer</span>}
                    <span className="muted"> on <Link href={`/products/${r.productSlug}`} target="_blank">{r.productName}</Link>, {new Date(r.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                  </p>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className={`pill ${r.status === "approved" ? "active" : "refunded"}`}>{r.status === "approved" ? "Showing" : "Hidden"}</span>
                  {r.status === "approved"
                    ? <button className="btn sm ghost" disabled={updating === r.id} onClick={() => setStatus(r, "rejected")}>Hide</button>
                    : <button className="btn sm" disabled={updating === r.id} onClick={() => setStatus(r, "approved")}>Show again</button>}
                </div>
              </div>
              {r.title && <b style={{ fontSize: 15 }}>{r.title}</b>}
              {r.body && <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{r.body}</p>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
