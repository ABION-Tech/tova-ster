"use client";

import { useEffect, useState } from "react";
import { adminJson } from "../../lib/backend";

interface Step { key: string; label: string; count: number; cookieOnly: boolean }

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "–");

/** Sales funnel: how many shoppers reach each step, and how many carry on to the next. */
export function Funnel() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<{ steps: Step[]; sales: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setData(null); setErr(null);
    adminJson<{ steps: Step[]; sales: number }>(`/admin/reports/funnel?days=${days}`).then(setData).catch((e: Error) => setErr(e.message));
  }, [days]);

  const top = data ? Math.max(1, ...data.steps.map((s) => s.count)) : 1;
  return (
    <section className="acard" aria-labelledby="funnel-h">
      <div className="ahead">
        <b id="funnel-h">Sales funnel</b>
        <select className="ain" style={{ width: 140 }} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
          <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
        </select>
      </div>
      {err && <p className="muted">{err}</p>}
      {!data ? !err && <p className="muted">Loading…</p> : (
        <>
          <div style={{ display: "grid", gap: 10 }}>
            {data.steps.map((s, i) => {
              const prev = data.steps[i - 1];
              return (
                <div key={s.key} style={{ display: "grid", gridTemplateColumns: "minmax(130px, 170px) 1fr 70px", gap: 10, alignItems: "center", fontSize: 14 }}>
                  <span>{s.label}{s.cookieOnly && <sup aria-hidden="true">*</sup>}</span>
                  <span style={{ background: "var(--surface-2)", borderRadius: 6, height: 26, position: "relative", overflow: "hidden" }}>
                    <span style={{ position: "absolute", inset: 0, width: `${(s.count / top) * 100}%`, background: i === data.steps.length - 1 ? "var(--good)" : "var(--gold)", borderRadius: 6 }} />
                    <b style={{ position: "relative", padding: "0 8px", lineHeight: "26px" }}>{s.count.toLocaleString("en-GB")}</b>
                  </span>
                  {/* Cookie-only steps count fewer people, so a rate from one into a step that counts everyone would mislead. */}
                  <span className="muted" title={prev && !(prev.cookieOnly && !s.cookieOnly) ? `of those who ${prev.label.toLowerCase()}` : undefined}>{prev && !(prev.cookieOnly && !s.cookieOnly) ? pct(s.count, prev.count) : ""}</span>
                </div>
              );
            })}
          </div>
          <p className="muted" style={{ margin: 0 }}>
            Overall, {pct(data.steps.at(-1)!.count, data.steps.find((s) => s.key === "baskets")!.count)} of baskets became paid orders
            {" "}(£{data.sales.toFixed(2)} in sales). The percentage on a row is how many of the step above carried on.
            {" "}<sup>*</sup>Visits and product views only count shoppers who accepted analytics cookies, so they read lower than the real number.
          </p>
        </>
      )}
    </section>
  );
}
