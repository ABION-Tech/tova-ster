import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { destroySession, requireUser } from "../auth/session.js";
import { findUserById } from "../auth/users.js";
import { verifyPassword } from "../auth/passwords.js";
import { eraseAccount } from "../auth/eraseAccount.js";
import { updateUserProfile } from "../auth/users.js";
import { pool } from "../db/pool.js";
import { logEvent } from "../events/eventsRepo.js";
import { cleanBirthday } from "./auth.js";

/**
 * Account-only. No admin fields, no password/auth data ever returned here —
 * that's the same shape session.ts already builds for /auth/me.
 */
export const profileRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get("/profile", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return; // requireUser already sent the 401

    return reply.send({ user });
  });

  app.patch(
    "/profile",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            firstName: { type: "string", minLength: 1 },
            lastName: { type: "string", minLength: 1 },
            phone: { type: "string" },
            birthdayDay: { type: ["integer", "null"], minimum: 1, maximum: 31 },
            birthdayMonth: { type: ["integer", "null"], minimum: 1, maximum: 12 },
          },
        },
      },
    },
    async (req, reply) => {
      const user = await requireUser(req, reply);
      if (!user) return;

      const { firstName, lastName, phone } = req.body as {
        firstName?: string;
        lastName?: string;
        phone?: string;
      };

      // Birthday: send both to set or change it, or both as null to remove it.
      const b = req.body as { birthdayDay?: number | null; birthdayMonth?: number | null };
      let birthday: { day: number | null; month: number | null } = { day: user.birthdayDay, month: user.birthdayMonth };
      if ("birthdayDay" in b || "birthdayMonth" in b) {
        const c = cleanBirthday(b.birthdayDay, b.birthdayMonth);
        if (c === "invalid") return reply.status(400).send({ error: "That birthday isn't a real date. Please check the day and month." });
        birthday = c ? { day: c.day, month: c.month } : { day: null, month: null };
        if (birthday.day !== user.birthdayDay || birthday.month !== user.birthdayMonth) {
          await pool.query(`UPDATE users SET birthday_day = $2, birthday_month = $3 WHERE id = $1`, [user.id, birthday.day, birthday.month]);
          await logEvent({ type: "profile", message: !c ? "Removed their birthday" : user.birthdayDay ? "Changed their birthday" : "Added their birthday", userId: user.id });
        }
      }
      const updated = await updateUserProfile(user.id, { firstName, lastName, phone });

      return reply.send({
        user: {
          id: updated.id,
          email: updated.email,
          firstName: updated.first_name,
          lastName: updated.last_name,
          emailVerified: updated.email_verified,
          birthdayDay: birthday.day,
          birthdayMonth: birthday.month,
        },
      });
    },
  );
  // Customers delete their own account: password to confirm, then personal details are erased (see auth/eraseAccount.ts).
  app.delete("/profile", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { password } = (req.body ?? {}) as { password?: string };
    const record = await findUserById(user.id);
    if (!record || !password || !(await verifyPassword(password, record.password_hash))) {
      return reply.status(400).send({ error: "That password isn't right." });
    }
    const r = await eraseAccount(user.id);
    if (!r.ok) {
      return reply.status(409).send({ error: `You have an order on its way (${r.orders.join(", ")}). Once it's delivered you can delete your account, or email info@tova-ster.com and we'll help.` });
    }
    await destroySession(req, reply);
    return reply.send({ ok: true });
  });
};
