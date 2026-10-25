import { pool } from "../db/pool.js";

export interface UserRecord {
  id: string;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email_verified: boolean;
  email_verification_token: string | null;
  email_verification_expires_at: string | null;
  password_reset_token: string | null;
  password_reset_expires_at: string | null;
  birthday_day: number | null;
  birthday_month: number | null;
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const result = await pool.query<UserRecord>(
    "SELECT * FROM users WHERE lower(email) = lower($1)",
    [email],
  );
  return result.rows[0] ?? null;
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  const result = await pool.query<UserRecord>("SELECT * FROM users WHERE id = $1", [id]);
  return result.rows[0] ?? null;
}

export async function createUser(input: {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  phone?: string;
  emailVerificationTokenHash: string;
  emailVerificationExpiresAt: Date;
}): Promise<UserRecord> {
  const result = await pool.query<UserRecord>(
    `INSERT INTO users (
       email, password_hash, first_name, last_name, phone,
       email_verification_token, email_verification_expires_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.email,
      input.passwordHash,
      input.firstName,
      input.lastName,
      input.phone ?? null,
      input.emailVerificationTokenHash,
      input.emailVerificationExpiresAt,
    ],
  );
  return result.rows[0];
}

export async function markEmailVerified(userId: string): Promise<void> {
  await pool.query(
    `UPDATE users
     SET email_verified = TRUE, email_verification_token = NULL, email_verification_expires_at = NULL
     WHERE id = $1`,
    [userId],
  );
}

export async function setPasswordResetToken(
  userId: string,
  tokenHash: string,
  expiresAt: Date,
): Promise<void> {
  await pool.query(
    `UPDATE users SET password_reset_token = $1, password_reset_expires_at = $2 WHERE id = $3`,
    [tokenHash, expiresAt, userId],
  );
}

/**
 * Partial update: only fields actually provided are changed. Note phone
 * can't currently be explicitly cleared back to null this way (an
 * undefined phone means "leave as-is") — acceptable for Stage 3's scope,
 * worth revisiting if "remove my phone number" becomes a real requirement.
 */
export async function updateUserProfile(
  userId: string,
  input: { firstName?: string; lastName?: string; phone?: string },
): Promise<UserRecord> {
  const result = await pool.query<UserRecord>(
    `UPDATE users
     SET first_name = COALESCE($2, first_name),
         last_name  = COALESCE($3, last_name),
         phone      = COALESCE($4, phone)
     WHERE id = $1
     RETURNING *`,
    [userId, input.firstName ?? null, input.lastName ?? null, input.phone ?? null],
  );
  return result.rows[0];
}

export async function resetPassword(userId: string, passwordHash: string): Promise<void> {
  await pool.query(
    `UPDATE users
     SET password_hash = $1, password_reset_token = NULL, password_reset_expires_at = NULL
     WHERE id = $2`,
    [passwordHash, userId],
  );
}
