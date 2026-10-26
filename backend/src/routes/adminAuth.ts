import { pool } from "../db/pool.js";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { verifyPassword, hashPassword } from "../auth/passwords.js";
import { findAdminByEmail, touchLastLogin } from "../auth/adminUsers.js";
import { areasFor } from "../auth/permissions.js";
import { MIN_PASSWORD, acceptInvite, findInvite } from "../auth/team.js";
import { logEvent } from "../events/eventsRepo.js";
import { beginSetup, confirmSetup, createTicket, dropTicket, turnOff, twoStepRequired, twoStepStatus, useTicket, verifyForSignIn } from "../auth/totp.js";
import { createAdminSession, destroyAdminSession, getAdminFromRequest } from "../auth/adminSession.js";

// Same fixed-cost-dummy-hash trick as customer login (routes/auth.ts) — an
// unknown admin email and a wrong password should take indistinguishable
// time, so this endpoint can't be used to enumerate admin accounts.
const DUMMY_PASSWORD_HASH = await hashPassword("not-a-real-admin-account-do-not-reuse");
const GENERIC_LOGIN_ERROR = "Invalid email or password.";

export const adminAuthRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post(
    "/admin/auth/login",
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
      const record = await findAdminByEmail(email.trim().toLowerCase());

      const valid = await verifyPassword(password, record?.password_hash ?? DUMMY_PASSWORD_HASH);
      if (!record || !valid || !record.active) {
        return reply.status(401).send({ error: GENERIC_LOGIN_ERROR });
      }

      // With two-step sign-in on, the password only earns a 5-minute ticket for the code step.
      if ((await twoStepStatus(record.id)).enabled) {
        return reply.send({ needsCode: true, ticket: await createTicket(record.id) });
      }
      await createAdminSession(record.id, req, reply);
      await touchLastLogin(record.id);

      return reply.send({ admin: { id: record.id, email: record.email, name: record.name, role: record.role }, setupTwoStep: twoStepRequired() });
    },
  );

  app.post("/admin/auth/logout", async (req, reply) => {
    await destroyAdminSession(req, reply);
    return reply.send({ ok: true });
  });

  app.get("/admin/auth/me", async (req, reply) => {
    const admin = await getAdminFromRequest(req);
    if (!admin) return reply.status(401).send({ error: "Admin sign-in required." });
    const status = await twoStepStatus(admin.id);
    return reply.send({ admin, areas: areasFor(admin.role), twoStep: { ...status, required: twoStepRequired() } });
  });
  // Invite links from the Team page: check the link, then choose a password.
  app.get("/admin/auth/invite", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { token } = req.query as { token?: string };
    const inv = token ? await findInvite(token) : null;
    if (!inv) return reply.status(404).send({ error: "This link has expired or was already used. Ask the owner for a new one." });
    return reply.send({ name: inv.name, email: inv.email, role: inv.role });
  });

  app.post("/admin/auth/accept-invite", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { token, password } = (req.body ?? {}) as { token?: string; password?: string };
    const inv = token ? await findInvite(token) : null;
    if (!inv) return reply.status(404).send({ error: "This link has expired or was already used. Ask the owner for a new one." });
    if (!password || password.length < MIN_PASSWORD) return reply.status(400).send({ error: `Use at least ${MIN_PASSWORD} characters.` });
    try {
      await acceptInvite(inv.invite_id, inv.admin_user_id, password);
    } catch {
      return reply.status(409).send({ error: "This link was just used. Ask the owner for a new one." });
    }
    await createAdminSession(inv.admin_user_id, req, reply);
    await touchLastLogin(inv.admin_user_id);
    await logEvent({ type: "admin", adminId: inv.admin_user_id, message: `${inv.name} set their password and joined as ${inv.role}`, meta: { action: "team_join", role: inv.role } });
    return reply.send({ admin: { id: inv.admin_user_id, email: inv.email, name: inv.name, role: inv.role } });
  });
  // ── Two-step sign-in ─────────────────────────────────────────────────────
  app.post("/admin/auth/verify-code", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { ticket, code } = (req.body ?? {}) as { ticket?: string; code?: string };
    const t = ticket ? await useTicket(ticket) : null;
    if (!t) return reply.status(401).send({ error: "That took too long or had too many tries. Sign in again." });
    const result = await verifyForSignIn(t.adminId, String(code ?? ""));
    if (result === "bad") return reply.status(401).send({ error: "That code didn't match. Check your authenticator app and try again." });
    await dropTicket(t.id);
    await createAdminSession(t.adminId, req, reply);
    await touchLastLogin(t.adminId);
    const a = await pool.query<{ name: string; email: string; role: string }>(`SELECT name, email, role FROM admin_users WHERE id = $1`, [t.adminId]);
    if (result === "recovery") {
      await logEvent({ type: "admin", adminId: t.adminId, message: `${a.rows[0].name} signed in with a recovery code`, meta: { action: "two_step_recovery" } });
    }
    return reply.send({ admin: { id: t.adminId, ...a.rows[0] }, usedRecovery: result === "recovery" });
  });

  app.get("/admin/auth/2fa", async (req, reply) => {
    const admin = await getAdminFromRequest(req);
    if (!admin) return reply.status(401).send({ error: "Admin sign-in required." });
    return reply.send({ ...(await twoStepStatus(admin.id)), required: twoStepRequired() });
  });

  app.post("/admin/auth/2fa/setup", async (req, reply) => {
    const admin = await getAdminFromRequest(req);
    if (!admin) return reply.status(401).send({ error: "Admin sign-in required." });
    return reply.send(await beginSetup(admin.id, admin.email));
  });

  app.post("/admin/auth/2fa/confirm", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const admin = await getAdminFromRequest(req);
    if (!admin) return reply.status(401).send({ error: "Admin sign-in required." });
    const codes = await confirmSetup(admin.id, String((req.body as { code?: string } | undefined)?.code ?? "").replace(/\s/g, ""));
    if (!codes) return reply.status(400).send({ error: "That code didn't match. Use the 6-digit code your app shows now." });
    await logEvent({ type: "admin", adminId: admin.id, message: `${admin.name} turned on two-step sign-in`, meta: { action: "two_step_on" } });
    return reply.send({ recoveryCodes: codes });
  });

  app.post("/admin/auth/2fa/off", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    const admin = await getAdminFromRequest(req);
    if (!admin) return reply.status(401).send({ error: "Admin sign-in required." });
    if (twoStepRequired()) return reply.status(400).send({ error: "Two-step sign-in is required for the team. To move it to a new phone, set it up again." });
    const ok = await verifyForSignIn(admin.id, String((req.body as { code?: string } | undefined)?.code ?? ""));
    if (ok === "bad") return reply.status(400).send({ error: "Enter a current code to turn it off." });
    await turnOff(admin.id);
    await logEvent({ type: "admin", adminId: admin.id, message: `${admin.name} turned off two-step sign-in`, meta: { action: "two_step_off" } });
    return reply.send({ ok: true });
  });
};
