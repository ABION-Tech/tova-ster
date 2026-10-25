"use client";

import { useEffect, useState } from "react";

/** Shown only when neither the server nor this browser has the shop data yet. */
export function Loading() {
  const [slow, setSlow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSlow(true), 6000); return () => clearTimeout(t); }, []);
  return (
    <main className="wrap">
      <div className="empty" style={{ marginTop: 40 }} role="status">
        <b>{slow ? "The shop is taking longer than usual" : "Loading the shop…"}</b>
        {slow && <p>Please check your connection and refresh the page. Your basket is saved.</p>}
      </div>
    </main>
  );
}
