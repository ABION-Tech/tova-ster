import type { FastifyReply, FastifyRequest } from "fastify";
import { pool } from "../db/pool.js";
import { generateToken, hashToken } from "./tokens.js";

export const SESSION_COOKIE = "session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  emailVerified: boolean;
  birthdayDay: number | null;   // birthday without the year
  birthdayMonth: number | null;
}

// Cross-site cookies (Vercel frontend domain, Railway backend domain) need
// SameSite=None + Secure. Local dev (http://localhost) can't set Secure, so
// it falls back to Lax there — this only ever branches on NODE_ENV, never
// on anything request-supplied.
function cookieOptions(maxAgeMs: number) {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: (isProd ? "none" : "lax") as "none" | "lax",
    path: "/",
    maxAge: Math.floor(maxAgeMs / 1000),
  };
}

export async function createSession(
  userId: string,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { raw, hash } = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, hash, req.headers["user-agent"] ?? null, req.ip, expiresAt],
  );

  reply.setCookie(SESSION_COOKIE, raw, cookieOptions(SESSION_TTL_MS));
}

export async function getUserFromRequest(req: FastifyRequest): Promise<AuthUser | null> {
  const raw = req.cookies[SESSION_COOKIE];
  if (!raw) return null;

  const hash = hashToken(raw);
  const result = await pool.query<{
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    email_verified: boolean;
    birthday_day: number | null;
    birthday_month: number | null;
  }>(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.email_verified, u.birthday_day, u.birthday_month
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hash],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    emailVerified: row.email_verified,
    birthdayDay: row.birthday_day,
    birthdayMonth: row.birthday_month,
  };
}

/**
 * Shared guard for any route that requires a signed-in user (profile,
 * addresses, future order history). Sends the 401 itself so every caller
 * gets the same shape and callers just need `if (!user) return;`.
 */
export async function requireUser(req: FastifyRequest, reply: FastifyReply): Promise<AuthUser | null> {
  const user = await getUserFromRequest(req);
  if (!user) {
    reply.status(401).send({ error: "Not signed in." });
    return null;
  }
  return user;
}

export async function destroySession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const raw = req.cookies[SESSION_COOKIE];
  if (raw) {
    await pool.query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(raw)]);
  }
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

/** Password reset / "log out everywhere" both need every session for a user gone. */
export async function destroyAllSessionsForUser(userId: string): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
}

export { cookieOptions as sessionCookieOptions };
