import type { FastifyReply, FastifyRequest } from "fastify";
import { secureCookies } from "./cookieMode.js";
import { pool } from "../db/pool.js";
import { generateToken, hashToken } from "./tokens.js";

export const ADMIN_SESSION_COOKIE = "admin_session";
// Shorter-lived than a customer session (30 days) — an admin account can
// touch every order and every customer's data, so a stolen laptop shouldn't
// stay logged in for a month.
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export type AdminRole = "Owner" | "Manager" | "Support" | "Packer";

export interface AdminAuthUser {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  /** Two-step sign-in is set up for this person. */
  twoStep: boolean;
}

function adminCookieOptions(maxAgeMs: number) {
  const isProd = secureCookies;
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: (isProd ? "none" : "lax") as "none" | "lax",
    path: "/",
    maxAge: Math.floor(maxAgeMs / 1000),
  };
}

export async function createAdminSession(
  adminUserId: string,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { raw, hash } = generateToken();
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_TTL_MS);

  await pool.query(
    `INSERT INTO admin_sessions (admin_user_id, token_hash, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [adminUserId, hash, req.headers["user-agent"] ?? null, req.ip, expiresAt],
  );

  reply.setCookie(ADMIN_SESSION_COOKIE, raw, adminCookieOptions(ADMIN_SESSION_TTL_MS));
}

// One lookup per request: the admin gate and the route handler share it.
const seen = new WeakMap<FastifyRequest, AdminAuthUser | null>();

export async function getAdminFromRequest(req: FastifyRequest): Promise<AdminAuthUser | null> {
  if (seen.has(req)) return seen.get(req) ?? null;
  const admin = await lookupAdmin(req);
  seen.set(req, admin);
  return admin;
}

async function lookupAdmin(req: FastifyRequest): Promise<AdminAuthUser | null> {
  const raw = req.cookies[ADMIN_SESSION_COOKIE];
  if (!raw) return null;

  const hash = hashToken(raw);
  const result = await pool.query<AdminAuthUser>(
    `SELECT a.id, a.email, a.name, a.role, (a.totp_enabled_at IS NOT NULL AND a.totp_secret IS NOT NULL) AS "twoStep"
     FROM admin_sessions s
     JOIN admin_users a ON a.id = s.admin_user_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND a.active`,
    [hash],
  );

  return result.rows[0] ?? null;
}

/**
 * Guard for every admin-only route. Sends the 401 itself so callers just
 * need `if (!admin) return;` — same shape as customer `requireUser`.
 */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<AdminAuthUser | null> {
  const admin = await getAdminFromRequest(req);
  if (!admin) {
    reply.status(401).send({ error: "Admin sign-in required." });
    return null;
  }
  return admin;
}

export async function destroyAdminSession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const raw = req.cookies[ADMIN_SESSION_COOKIE];
  if (raw) {
    await pool.query("DELETE FROM admin_sessions WHERE token_hash = $1", [hashToken(raw)]);
  }
  reply.clearCookie(ADMIN_SESSION_COOKIE, { path: "/" });
}

/**
 * Role check on top of requireAdmin. Owner can do everything; the list names
 * the other roles allowed. Packers only see dispatch; Support handles orders
 * and customers; Managers run the shop but not the team or payment settings.
 */
export async function requireRole(req: FastifyRequest, reply: FastifyReply, ...roles: AdminRole[]): Promise<AdminAuthUser | null> {
  const admin = await requireAdmin(req, reply);
  if (!admin) return null;
  if (admin.role !== "Owner" && !roles.includes(admin.role)) {
    reply.status(403).send({ error: `Your role (${admin.role}) can't do this. Ask the owner.` });
    return null;
  }
  return admin;
}
