import { pool } from "../db/pool.js";
import { getSetting } from "../settings/settingsRepo.js";
import { logEvent, purgeOldBrowsingEvents } from "../events/eventsRepo.js";
import { emailService } from "../services/email/index.js";

/** Today's date in the UK, whatever the server's time zone. */
function ukToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/**
 * Birthday treats: once a year, on the customer's birthday (UK date), add the
 * birthday points, send the birthday email and record it. 29 February
 * birthdays are celebrated on 28 February in other years. Safe to run many
 * times a day: each customer is claimed once per year in a single update.
 */
export async function runBirthdayTreats(now = new Date()): Promise<number> {
  const f = await getSetting("features");
  if (!f.birthday?.on) return 0;
  const { year, month, day } = ukToday(now);
  const feb28 = month === 2 && day === 28 && !isLeap(year);
  const points = f.rewards.on ? Math.max(0, Math.floor(Number(f.birthday.points) || 0)) : 0;
  const claimed = await pool.query<{ id: string; email: string; first_name: string }>(
    `UPDATE users SET birthday_treat_year = $1,
                      points_balance = points_balance + $4
     WHERE birthday_month IS NOT NULL
       AND (birthday_treat_year IS DISTINCT FROM $1)
       AND ((birthday_month = $2 AND birthday_day = $3) OR ($5 AND birthday_month = 2 AND birthday_day = 29))
     RETURNING id, email, first_name`,
    [year, month, day, points, feb28],
  );
  for (const u of claimed.rows) {
    if (points > 0) await pool.query(`INSERT INTO points_ledger (user_id, delta, reason) VALUES ($1, $2, 'Happy birthday from Tova-Ster')`, [u.id, points]);
    await logEvent({ type: "birthday", message: points > 0 ? `Birthday treat: ${points} points` : "Birthday email", userId: u.id, meta: { points } });
    emailService.send({ to: u.email, subject: `Happy birthday, ${u.first_name}!`, template: "birthday", data: { firstName: u.first_name, points, pounds: (points * Number(f.rewards.pointValue || 1)) / 100 } }, u.id)
      .catch(() => { /* already recorded as a failed email */ });
  }
  return claimed.rowCount ?? 0;
}

/** Deletes browsing records older than the retention period (orders, payments and team changes are kept). */
export async function runRetention(): Promise<number> {
  const b = await getSetting("business");
  return purgeOldBrowsingEvents(Number(b.retentionMonths));
}

/** Runs the daily jobs now and then every hour (each is safe to repeat). */
export function startDailyJobs(log: { error: (o: unknown, m: string) => void; info: (m: string) => void }) {
  const run = async () => {
    try { const n = await runBirthdayTreats(); if (n) log.info(`Birthday treats sent: ${n}`); } catch (err) { log.error(err, "birthday treats failed"); }
    try { const n = await runRetention(); if (n) log.info(`Old browsing records deleted: ${n}`); } catch (err) { log.error(err, "retention clean-up failed"); }
  };
  setTimeout(run, 15_000).unref();
  setInterval(run, 60 * 60 * 1000).unref();
}
