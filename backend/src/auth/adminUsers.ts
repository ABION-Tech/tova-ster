import { pool } from "../db/pool.js";

export interface AdminUserRecord {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  last_login_at: string | null;
}

export async function findAdminByEmail(email: string): Promise<AdminUserRecord | null> {
  const result = await pool.query<AdminUserRecord>(
    "SELECT * FROM admin_users WHERE lower(email) = lower($1)",
    [email],
  );
  return result.rows[0] ?? null;
}

export async function findAdminById(id: string): Promise<AdminUserRecord | null> {
  const result = await pool.query<AdminUserRecord>("SELECT * FROM admin_users WHERE id = $1", [id]);
  return result.rows[0] ?? null;
}

export async function touchLastLogin(id: string): Promise<void> {
  await pool.query("UPDATE admin_users SET last_login_at = now() WHERE id = $1", [id]);
}
