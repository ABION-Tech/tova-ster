"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { adminJson } from "../../../lib/backend";

interface AdminReview {
  id: string;
  productId: string;
  productName: string;
  productSlug: string;
  userId: string;
  reviewerName: string;
  rating: number;
  title: string | null;
  body: string | null;
  status: string;
  verifiedPurchase: boolean;
  createdAt: string;
}

const STARS = ["", "★", "★★", "★★★", "★★★★", "★★★★★"];
const STATUS_TABS = ["all", "approved", "rejected"];

export default function AdminReviewsPage() {
  const [reviews, setReviews] = useState<AdminReview[]>([]);
  const [total, setTotal] = useState(0);
  const [tab, setTab] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  function load(status: string) {
    setLoading(true);
    setError(null);
    adminJson<{ reviews: AdminReview[]; total: number }>(`/admin/reviews?status=${status}&limit=100`)
      .then((d) => { setReviews(d.reviews); setTotal(d.total); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(tab); }, [tab]);

  async function updateStatus(id: string, status: "approved" | "rejected") {
    setUpdating(id);
    setUpdateError(null);
    try {
      await adminJson(`/admin/reviews/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setReviews((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    } catch (e: unknown) {
      setUpdateError(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setUpdating(null);
    }
  }

  return (
    <main>
      <h1 className="display-3" style={{ marginBottom: 20 }}>Reviews</h1>

      <div style={{ display: "flex", gap: 4, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        {STATUS_TABS.map((s) => (
          <button
            key={s}
            onClick={() => setTab(s)}
            style={{
              padding: "4px 14px",
              border: `1px solid ${tab === s ? "var(--gold-deep)" : "var(--line)"}`,
              borderRadius: 4,
              background: tab === s ? "var(--gold-deep)" : "var(--surface)",
              color: tab === s ? "var(--surface)" : "var(--ink-muted)",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: tab === s ? 600 : 400,
              textTransform: "capitalize",
            }}
          >
            {s}
          </button>
        ))}
        <span style={{ marginLeft: 12, fontSize: 13, color: "var(--ink-muted)", lineHeight: "30px" }}>
          {total} review{total !== 1 ? "s" : ""}
        </span>
      </div>

      {error && <p style={{ color: "var(--danger-text)" }}>{error}</p>}
      {updateError && <p style={{ color: "var(--danger-text)" }}>{updateError}</p>}
      {loading && <p>Loading…</p>}

      {!loading && reviews.length === 0 && (
        <p style={{ color: "var(--ink-muted)", fontSize: 13 }}>No reviews found.</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {reviews.map((review) => (
          <div
            key={review.id}
            style={{
              border: `1px solid ${review.status === "rejected" ? "#E3B4A4" : "var(--line)"}`,
              borderRadius: 8,
              padding: 16,
              background: review.status === "rejected" ? "var(--danger-bg)" : "var(--surface)",
              opacity: review.status === "rejected" ? 0.75 : 1,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
              <div>
                <Link href={`/products/${review.productSlug}`} target="_blank" style={{ fontWeight: 700, fontSize: 14, color: "var(--gold-deep)" }}>
                  {review.productName}
                </Link>
                <span style={{ fontSize: 12, color: "var(--ink-muted)", marginLeft: 8 }}>
                  {review.reviewerName}
                  {review.verifiedPurchase && (
                    <span style={{ marginLeft: 6, color: "var(--success-text)", fontWeight: 600 }}>✓ Verified</span>
                  )}
                </span>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: review.status === "approved" ? "var(--success-text)" : "var(--danger-text)", fontWeight: 600, textTransform: "uppercase" }}>
                  {review.status}
                </span>
                {review.status !== "approved" && (
                  <button
                    disabled={updating === review.id}
                    onClick={() => updateStatus(review.id, "approved")}
                    style={{ padding: "3px 10px", fontSize: 12, border: "1px solid var(--success-text)", color: "var(--success-text)", borderRadius: 4, cursor: "pointer", background: "var(--surface)" }}
                  >
                    Approve
                  </button>
                )}
                {review.status !== "rejected" && (
                  <button
                    disabled={updating === review.id}
                    onClick={() => updateStatus(review.id, "rejected")}
                    style={{ padding: "3px 10px", fontSize: 12, border: "1px solid var(--danger-text)", color: "var(--danger-text)", borderRadius: 4, cursor: "pointer", background: "var(--surface)" }}
                  >
                    Reject
                  </button>
                )}
              </div>
            </div>

            <div style={{ color: "var(--gold)", fontSize: 16, marginBottom: 4 }}>{STARS[review.rating]}</div>
            {review.title && <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{review.title}</p>}
            {review.body && <p style={{ fontSize: 13, color: "var(--ink-muted)", lineHeight: 1.6 }}>{review.body}</p>}
            <p style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 8 }}>
              {new Date(review.createdAt).toLocaleString("en-NG")} · ID: {review.id}
            </p>
          </div>
        ))}
      </div>
    </main>
  );
}
