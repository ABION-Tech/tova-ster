import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";
import { pool } from "../db/pool.js";
import { seal, open } from "../instagram/secretBox.js";
import { generateToken, hashToken } from "./tokens.js";

/**
 * Two-step sign-in with an authenticator app (RFC 6238 TOTP: SHA-1, 6 digits,
 * 30-second steps, one step either side allowed for clock drift). Secrets are
 * sealed with AES-256-GCM; a used step is remembered so a code works once.
 */
const STEP = 30;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) continue;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function codeAt(secret: Buffer, step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", secret).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

/** The step a code matches (now ±1), or null. */
export function matchStep(secretB32: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretB32);
  const cur = Math.floor(now / 1000 / STEP);
  for (const s of [cur, cur - 1, cur + 1]) {
    const a = Buffer.from(codeAt(secret, s)); const b = Buffer.from(code);
    if (timingSafeEqual(a, b)) return s;
  }
  return null;
}

export const twoStepRequired = () => process.env.NODE_ENV === "production" || process.env.ADMIN_2FA_REQUIRED === "true";

export async function twoStepStatus(adminId: string): Promise<{ enabled: boolean; recoveryLeft: number }> {
  const r = await pool.query<{ on: boolean; left: string }>(
    `SELECT (totp_enabled_at IS NOT NULL AND totp_secret IS NOT NULL) AS on,
            (SELECT count(*) FROM admin_recovery_codes WHERE admin_user_id = $1 AND used_at IS NULL) AS left
       FROM admin_users WHERE id = $1`, [adminId]);
  return { enabled: Boolean(r.rows[0]?.on), recoveryLeft: Number(r.rows[0]?.left ?? 0) };
}

/** Starts setup: a new secret, kept pending until the first code is confirmed. */
export async function beginSetup(adminId: string, email: string): Promise<{ secret: string; uri: string; qrSvg: string }> {
  const secret = base32Encode(randomBytes(20));
  await pool.query(`UPDATE admin_users SET totp_pending = $2 WHERE id = $1`, [adminId, seal(secret)]);
  const uri = `otpauth://totp/${encodeURIComponent(`Tova-Ster:${email}`)}?secret=${secret}&issuer=Tova-Ster&algorithm=SHA1&digits=6&period=30`;
  const qrSvg = await QRCode.toString(uri, { type: "svg", margin: 1, width: 200 });
  return { secret, uri, qrSvg };
}

/** Confirms setup with a code; returns fresh recovery codes (shown once). */
export async function confirmSetup(adminId: string, code: string): Promise<string[] | null> {
  const r = await pool.query<{ totp_pending: string | null }>(`SELECT totp_pending FROM admin_users WHERE id = $1`, [adminId]);
  const pending = r.rows[0]?.totp_pending ? open(r.rows[0].totp_pending) : null;
  if (!pending) return null;
  const step = matchStep(pending, code);
  if (step === null) return null;
  const codes = Array.from({ length: 8 }, () => randomBytes(5).toString("hex").toUpperCase().replace(/(.{5})/, "$1-"));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE admin_users SET totp_secret = totp_pending, totp_pending = NULL, totp_enabled_at = now(), totp_last_step = $2 WHERE id = $1`,
      [adminId, step],
    );
    await client.query(`DELETE FROM admin_recovery_codes WHERE admin_user_id = $1`, [adminId]);
    for (const c of codes) await client.query(`INSERT INTO admin_recovery_codes (admin_user_id, code_hash) VALUES ($1, $2)`, [adminId, hashToken(c)]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK"); throw e;
  } finally { client.release(); }
  return codes;
}

/** Checks a sign-in code (or a recovery code) and marks it used. */
export async function verifyForSignIn(adminId: string, input: string): Promise<"ok" | "recovery" | "bad"> {
  const code = input.trim().toUpperCase();
  if (/^[0-9A-F]{5}-[0-9A-F]{5}$/.test(code)) {
    const used = await pool.query(
      `UPDATE admin_recovery_codes SET used_at = now() WHERE admin_user_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING id`,
      [adminId, hashToken(code)],
    );
    return used.rowCount ? "recovery" : "bad";
  }
  const r = await pool.query<{ totp_secret: string | null; totp_last_step: string | null }>(`SELECT totp_secret, totp_last_step FROM admin_users WHERE id = $1`, [adminId]);
  const secret = r.rows[0]?.totp_secret ? open(r.rows[0].totp_secret) : null;
  if (!secret) return "bad";
  const step = matchStep(secret, code.replace(/\s/g, ""));
  if (step === null) return "bad";
  // A step can't be used twice (stops a code being replayed within its 30 seconds).
  const upd = await pool.query(
    `UPDATE admin_users SET totp_last_step = $2 WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2) RETURNING id`,
    [adminId, step],
  );
  return upd.rowCount ? "ok" : "bad";
}

export async function turnOff(adminId: string): Promise<void> {
  await pool.query(`UPDATE admin_users SET totp_secret = NULL, totp_pending = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = $1`, [adminId]);
  await pool.query(`DELETE FROM admin_recovery_codes WHERE admin_user_id = $1`, [adminId]);
}

// ── Sign-in ticket between the password and the code (5 minutes, 5 tries) ──
export async function createTicket(adminId: string): Promise<string> {
  const { raw, hash } = generateToken();
  await pool.query(`DELETE FROM admin_mfa_tickets WHERE admin_user_id = $1 OR expires_at < now()`, [adminId]);
  await pool.query(`INSERT INTO admin_mfa_tickets (admin_user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '5 minutes')`, [adminId, hash]);
  return raw;
}

export async function useTicket(raw: string): Promise<{ id: string; adminId: string } | null> {
  const r = await pool.query<{ id: string; admin_user_id: string }>(
    `UPDATE admin_mfa_tickets SET attempts = attempts + 1
      WHERE token_hash = $1 AND expires_at > now() AND attempts < 5
      RETURNING id, admin_user_id`, [hashToken(raw)]);
  return r.rows[0] ? { id: r.rows[0].id, adminId: r.rows[0].admin_user_id } : null;
}

export async function dropTicket(id: string): Promise<void> {
  await pool.query(`DELETE FROM admin_mfa_tickets WHERE id = $1`, [id]);
}
