import { pool } from "../db/pool.js";
import { getSetting } from "../settings/settingsRepo.js";
import { logEvent } from "../events/eventsRepo.js";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { hashPassword, verifyPassword } from "../auth/passwords.js";
import { generateToken, hashToken } from "../auth/tokens.js";
import {
  createSession,
  destroyAllSessionsForUser,
  destroySession,
  getUserFromRequest,
} from "../auth/session.js";
import {
  createUser,
  findUserByEmail,
  markEmailVerified,
  resetPassword,
  setPasswordResetToken,
} from "../auth/users.js";
import { attachGuestCartToUser, GUEST_CART_COOKIE } from "../cart/cartService.js";
import { emailService } from "../services/email/index.js";

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1h

// Fixed-cost dummy hash so "no such account" and "wrong password" take
// roughly the same time at the login endpoint — otherwise the two failure
// paths are timing-distinguishable and leak which emails are registered.
const DUMMY_PASSWORD_HASH = await hashPassword("not-a-real-account-do-not-reuse");

/** Day + month only (no year). Both or neither; 29 Feb allowed. */
export function cleanBirthday(day: unknown, month: unknown): { day: number; month: number } | null | "invalid" {
  if ((day === undefined || day === null) && (month === undefined || month === null)) return null;
  const d = Number(day), m = Number(month);
  if (!Number.isInteger(d) || !Number.isInteger(m) || m < 1 || m > 12 || d < 1) return "invalid";
  const max = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31].at(m - 1) ?? 31;
  return d > max ? "invalid" : { day: d, month: m };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_LOGIN_ERROR = "Invalid email or password.";
const GENERIC_TOKEN_ERROR = "This link is invalid or has expired.";

function buildLink(path: string, params: Record<string, string>): string {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  const query = new URLSearchParams(params).toString();
  return `${base}${path}?${query}`;
}

/** Sign-up points (when rewards are on), marketing consent as ticked, and an activity entry. */
async function welcomeNewCustomer(userId: string, marketingEmail: boolean, gaveBirthday = false): Promise<void> {
  const features = await getSetting("features");
  const bonus = features.rewards.on ? Math.max(0, Math.floor(Number(features.rewards.signup) || 0)) : 0;
  await pool.query(`UPDATE users SET marketing_email = $2, points_balance = points_balance + $3 WHERE id = $1`, [userId, marketingEmail, bonus]);
  if (bonus > 0) {
    await pool.query(`INSERT INTO points_ledger (user_id, delta, reason) VALUES ($1, $2, 'Welcome points for joining')`, [userId, bonus]);
  }
  await logEvent({ type: "signup", message: "New account created", userId, meta: { marketingEmail, birthday: gaveBirthday } });
}

export const authRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post(
    "/auth/register",
    {
      schema: {
        body: {
          type: "object",
          required: ["email", "password", "firstName", "lastName"],
          properties: {
            email: { type: "string", minLength: 3 },
            password: { type: "string", minLength: 8 },
            firstName: { type: "string", minLength: 1 },
            lastName: { type: "string", minLength: 1 },
            phone: { type: "string" },
            marketingEmail: { type: "boolean" },
            birthdayDay: { type: ["integer", "null"], minimum: 1, maximum: 31 },
            birthdayMonth: { type: ["integer", "null"], minimum: 1, maximum: 12 },
          },
        },
      },
      config: { rateLimit: { max: 5, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      const { password, firstName, lastName, phone } = req.body as {
        email: string;
        password: string;
        firstName: string;
        lastName: string;
        phone?: string;
      };
      const email = (req.body as { email: string }).email.trim().toLowerCase();

      if (!EMAIL_RE.test(email)) {
        return reply.status(400).send({ error: "Enter a valid email address." });
      }

      const existing = await findUserByEmail(email);
      if (existing) {
        return reply.status(409).send({ error: "An account with that email already exists." });
      }

      const birthday = cleanBirthday((req.body as { birthdayDay?: number | null }).birthdayDay, (req.body as { birthdayMonth?: number | null }).birthdayMonth);
      if (birthday === "invalid") return reply.status(400).send({ error: "That birthday isn't a real date. Please check the day and month." });

      const passwordHash = await hashPassword(password);
      const verification = generateToken();

      const user = await createUser({
        email,
        passwordHash,
        firstName,
        lastName,
        phone,
        emailVerificationTokenHash: verification.hash,
        emailVerificationExpiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
      });

      // Non-blocking by design: the account exists and can log in/shop
      // regardless of whether this send succeeds.
      try {
        await emailService.send({
          to: user.email,
          subject: "Verify your email",
          template: "email_verification",
          data: {
            firstName: user.first_name,
            link: buildLink("/verify-email", { token: verification.raw, email: user.email }),
          },
        });
      } catch (err) {
        req.log.error(err, "failed to send verification email");
      }

      if (birthday) await pool.query(`UPDATE users SET birthday_day = $2, birthday_month = $3 WHERE id = $1`, [user.id, birthday.day, birthday.month]);
      await welcomeNewCustomer(user.id, (req.body as { marketingEmail?: boolean }).marketingEmail === true, !!birthday);

      await createSession(user.id, req, reply);
      await attachGuestCartToUser(req.cookies[GUEST_CART_COOKIE], user.id, reply);

      return reply.status(201).send({
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          emailVerified: false,
          birthdayDay: birthday ? birthday.day : null,
          birthdayMonth: birthday ? birthday.month : null,
        },
      });
    },
  );

  app.post(
    "/auth/login",
    {
      schema: {
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string" },
            password: { type: "string" },
          },
        },
      },
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const { email, password } = req.body as { email: string; password: string };
      const record = await findUserByEmail(email.trim().toLowerCase());

      const valid = await verifyPassword(password, record?.password_hash ?? DUMMY_PASSWORD_HASH);
      if (!record || !valid) {
        return reply.status(401).send({ error: GENERIC_LOGIN_ERROR });
      }

      await createSession(record.id, req, reply);
      await attachGuestCartToUser(req.cookies[GUEST_CART_COOKIE], record.id, reply);

      return reply.send({
        user: {
          id: record.id,
          email: record.email,
          firstName: record.first_name,
          lastName: record.last_name,
          emailVerified: record.email_verified,
          birthdayDay: record.birthday_day,
          birthdayMonth: record.birthday_month,
        },
      });
    },
  );

  app.post("/auth/logout", async (req, reply) => {
    await destroySession(req, reply);
    return reply.send({ ok: true });
  });

  // For the storefront's first load: "who is this?" without an error for guests.
  app.get("/auth/session", async (req, reply) => {
    const user = await getUserFromRequest(req);
    reply.header("Cache-Control", "private, no-store");
    return reply.send({ user: user ?? null });
  });

  app.get("/auth/me", async (req, reply) => {
    const user = await getUserFromRequest(req);
    if (!user) return reply.status(401).send({ error: "Not signed in." });
    return reply.send({ user });
  });

  app.post(
    "/auth/verify-email",
    {
      schema: {
        body: {
          type: "object",
          required: ["email", "token"],
          properties: { email: { type: "string" }, token: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      const { email, token } = req.body as { email: string; token: string };
      const user = await findUserByEmail(email.trim().toLowerCase());

      if (!user) return reply.status(400).send({ error: GENERIC_TOKEN_ERROR });
      if (user.email_verified) return reply.send({ ok: true, alreadyVerified: true });

      const notExpired =
        user.email_verification_expires_at &&
        new Date(user.email_verification_expires_at).getTime() > Date.now();

      if (
        !user.email_verification_token ||
        !notExpired ||
        user.email_verification_token !== hashToken(token)
      ) {
        return reply.status(400).send({ error: GENERIC_TOKEN_ERROR });
      }

      await markEmailVerified(user.id);
      return reply.send({ ok: true });
    },
  );

  app.post(
    "/auth/request-password-reset",
    {
      schema: {
        body: {
          type: "object",
          required: ["email"],
          properties: { email: { type: "string" } },
        },
      },
      config: { rateLimit: { max: 5, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      const { email } = req.body as { email: string };
      const user = await findUserByEmail(email.trim().toLowerCase());

      // Always the same response whether or not the account exists —
      // otherwise this endpoint becomes an email-enumeration oracle.
      if (user) {
        const reset = generateToken();
        await setPasswordResetToken(
          user.id,
          reset.hash,
          new Date(Date.now() + PASSWORD_RESET_TTL_MS),
        );
        try {
          await emailService.send({
            to: user.email,
            subject: "Reset your password",
            template: "password_reset",
            data: {
              firstName: user.first_name,
              link: buildLink("/reset-password", { token: reset.raw, email: user.email }),
            },
          });
        } catch (err) {
          req.log.error(err, "failed to send password reset email");
        }
      }

      return reply.send({ ok: true, message: "If that email has an account, a reset link is on its way." });
    },
  );

  app.post(
    "/auth/reset-password",
    {
      schema: {
        body: {
          type: "object",
          required: ["email", "token", "newPassword"],
          properties: {
            email: { type: "string" },
            token: { type: "string" },
            newPassword: { type: "string", minLength: 8 },
          },
        },
      },
      config: { rateLimit: { max: 5, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      const { email, token, newPassword } = req.body as {
        email: string;
        token: string;
        newPassword: string;
      };
      const user = await findUserByEmail(email.trim().toLowerCase());

      const notExpired =
        user?.password_reset_expires_at &&
        new Date(user.password_reset_expires_at).getTime() > Date.now();

      if (
        !user ||
        !user.password_reset_token ||
        !notExpired ||
        user.password_reset_token !== hashToken(token)
      ) {
        return reply.status(400).send({ error: GENERIC_TOKEN_ERROR });
      }

      const passwordHash = await hashPassword(newPassword);
      await resetPassword(user.id, passwordHash);
      // Force re-login on every device — a password reset is exactly the
      // moment an old, possibly-compromised session should stop working.
      await destroyAllSessionsForUser(user.id);

      return reply.send({ ok: true });
    },
  );
};
