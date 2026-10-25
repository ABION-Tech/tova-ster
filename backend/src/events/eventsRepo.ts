import { pool } from "../db/pool.js";

export type EventType =
  | "visit" | "view" | "search" | "basket" | "quiz" | "checkout" | "order" | "payment" | "signup" | "subscription"
  | "points" | "review" | "newsletter" | "dispatch" | "email" | "admin" | "birthday" | "profile";

/**
 * Activity log. Never throws: a failed log line must never break a checkout.
 * Shop events (views, searches) are only sent by the storefront after the
 * visitor accepts analytics cookies; admin changes are always recorded.
 */
export async function logEvent(e: {
  type: EventType;
  message: string;
  userId?: string | null;
  adminId?: string | null;
  sessionId?: string | null;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO events (type, message, user_id, admin_id, session_id, meta) VALUES ($1, $2, $3, $4, $5, $6)`,
      [e.type, e.message.slice(0, 500), e.userId ?? null, e.adminId ?? null, e.sessionId?.slice(0, 80) ?? null, JSON.stringify(e.meta ?? {})],
    );
  } catch (err) {
    console.error("logEvent failed", err);
  }
}

export const logAdmin = (adminId: string, message: string, meta?: Record<string, unknown>) =>
  logEvent({ type: "admin", message, adminId, meta });

export async function listEvents(q: { type?: string; userId?: string; before?: number; limit?: number }) {
  const r = await pool.query(
    `SELECT e.id, e.type, e.message, e.meta, e.created_at, e.user_id, e.admin_id,
            a.name AS admin_name, u.email AS user_email
     FROM events e
     LEFT JOIN admin_users a ON a.id = e.admin_id
     LEFT JOIN users u ON u.id = e.user_id
     WHERE ($1::text IS NULL OR e.type = $1) AND ($2::uuid IS NULL OR e.user_id = $2) AND ($3::bigint IS NULL OR e.id < $3)
     ORDER BY e.id DESC LIMIT $4`,
    [q.type ?? null, q.userId ?? null, q.before ?? null, Math.min(q.limit ?? 50, 200)],
  );
  return r.rows;
}

/** Browsing events (not orders, payments or team changes) older than the retention period are deleted. */
export const BROWSING_EVENTS = ["visit", "view", "search", "quiz"] as const;
export async function purgeOldBrowsingEvents(months: number): Promise<number> {
  if (!(months > 0)) return 0;
  const r = await pool.query(
    `DELETE FROM events WHERE type = ANY($1::text[]) AND created_at < now() - make_interval(months => $2::int)`,
    [BROWSING_EVENTS, Math.floor(months)],
  );
  return r.rowCount ?? 0;
}

/** "amara@example.com" → "a***@example.com": enough to tell emails apart in the log without copying addresses around. */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  return domain ? `${user.slice(0, 1)}***@${domain}` : "***";
}
