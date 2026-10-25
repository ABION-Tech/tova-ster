import { randomBytes, createHmac } from "node:crypto";

const SESSION_SECRET = process.env.SESSION_SECRET;

// Required everywhere except local development. Staging is meant to mirror
// production's security posture, so it must not silently fall back to the
// hardcoded dev secret below just because someone forgot to set this in
// Railway's staging environment vars.
if (!SESSION_SECRET && process.env.NODE_ENV !== "development") {
  throw new Error(
    `SESSION_SECRET must be set outside local development (NODE_ENV=${process.env.NODE_ENV ?? "unset"}) — refusing to start without it.`,
  );
}

/**
 * Generates a new random bearer token (for a session cookie, an email
 * verification link, or a password reset link) plus the value that gets
 * stored in the database for it. The raw token is only ever handed to the
 * client (cookie or email link) — a stolen database dump alone can't be
 * turned back into a usable token, and can't authenticate as anyone.
 */
export function generateToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("hex");
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  // SESSION_SECRET as an HMAC key (rather than a plain SHA-256 digest) means
  // even a leaked DB + a leaked cookie/link from elsewhere still isn't
  // enough on its own without the app's own secret — defense in depth on
  // top of the tokens already being 256 bits of randomness.
  return createHmac("sha256", SESSION_SECRET ?? "dev-only-insecure-secret")
    .update(raw)
    .digest("hex");
}
