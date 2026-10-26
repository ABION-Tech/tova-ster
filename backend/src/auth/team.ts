import { pool } from "../db/pool.js";
import { generateToken, hashToken } from "./tokens.js";
import { hashPassword } from "./passwords.js";
import type { AdminRole } from "./adminSession.js";

export const ROLES: AdminRole[] = ["Owner", "Manager", "Support", "Packer"];
export const INVITE_HOURS = 48;
export const MIN_PASSWORD = 12;

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  active: boolean;
  has_password: boolean;
  last_login_at: string | null;
  created_at: string;
  invite_expires_at: string | null;
}

export async function listTeam(): Promise<TeamMember[]> {
  const r = await pool.query<TeamMember>(
    `SELECT a.id, a.name, a.email, a.role, a.active, (a.password_hash IS NOT NULL) AS has_password,
            a.last_login_at, a.created_at,
            (SELECT max(i.expires_at) FROM admin_invites i
              WHERE i.admin_user_id = a.id AND i.used_at IS NULL AND i.expires_at > now()) AS invite_expires_at
       FROM admin_users a
      ORDER BY a.active DESC, array_position(ARRAY['Owner','Manager','Support','Packer'], a.role), lower(a.name)`,
  );
  return r.rows;
}

export async function activeOwnerCount(): Promise<number> {
  const r = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM admin_users WHERE role = 'Owner' AND active`);
  return Number(r.rows[0].n);
}

/** New one-time link to choose a password. Earlier unused links for the same person stop working. */
export async function createInvite(adminUserId: string, createdBy: string | null, appUrl: string): Promise<{ link: string; expiresAt: Date }> {
  await pool.query(`UPDATE admin_invites SET used_at = now() WHERE admin_user_id = $1 AND used_at IS NULL`, [adminUserId]);
  const { raw, hash } = generateToken();
  const expiresAt = new Date(Date.now() + INVITE_HOURS * 3600_000);
  await pool.query(
    `INSERT INTO admin_invites (admin_user_id, token_hash, created_by, expires_at) VALUES ($1, $2, $3, $4)`,
    [adminUserId, hash, createdBy, expiresAt],
  );
  return { link: `${appUrl.replace(/\/$/, "")}/admin/accept-invite?token=${raw}`, expiresAt };
}

export async function findInvite(raw: string): Promise<{ invite_id: string; admin_user_id: string; name: string; email: string; role: AdminRole } | null> {
  const r = await pool.query(
    `SELECT i.id AS invite_id, a.id AS admin_user_id, a.name, a.email, a.role
       FROM admin_invites i JOIN admin_users a ON a.id = i.admin_user_id
      WHERE i.token_hash = $1 AND i.used_at IS NULL AND i.expires_at > now() AND a.active`,
    [hashToken(raw)],
  );
  return r.rows[0] ?? null;
}

/** Uses the invite, sets the password and signs the person out everywhere else. */
export async function acceptInvite(inviteId: string, adminUserId: string, password: string): Promise<void> {
  const hash = await hashPassword(password);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const used = await client.query(`UPDATE admin_invites SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id`, [inviteId]);
    if (!used.rowCount) throw new Error("Invite already used.");
    await client.query(`UPDATE admin_users SET password_hash = $2 WHERE id = $1`, [adminUserId, hash]);
    await client.query(`DELETE FROM admin_sessions WHERE admin_user_id = $1`, [adminUserId]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export function cleanEmail(v: unknown): string | null {
  const e = String(v ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200 ? e : null;
}
