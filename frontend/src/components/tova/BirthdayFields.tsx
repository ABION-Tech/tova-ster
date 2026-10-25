"use client";

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export const birthdayLabel = (d?: number | null, m?: number | null) => (d && m ? `${d} ${MONTHS.at(m - 1)}` : "");

/** Birthday as day + month only (never the year). Both empty = no birthday. */
export function BirthdayFields({ day, month, onChange, idPrefix = "bd" }: { day: number | null; month: number | null; onChange: (day: number | null, month: number | null) => void; idPrefix?: string }) {
  const max = month ? DAYS_IN.at(month - 1) ?? 31 : 31;
  return (
    <div className="fields">
      <div className="field"><label htmlFor={`${idPrefix}-d`}>Day</label>
        <select id={`${idPrefix}-d`} className="select" value={day ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null, month)}>
          <option value="">Day</option>
          {Array.from({ length: max }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
        </select></div>
      <div className="field"><label htmlFor={`${idPrefix}-m`}>Month</label>
        <select id={`${idPrefix}-m`} className="select" value={month ?? ""} onChange={(e) => { const m = e.target.value ? Number(e.target.value) : null; const lim = m ? DAYS_IN.at(m - 1) ?? 31 : 31; onChange(day && day > lim ? lim : day, m); }}>
          <option value="">Month</option>
          {MONTHS.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
        </select></div>
    </div>
  );
}
