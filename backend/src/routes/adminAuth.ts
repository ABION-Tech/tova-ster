import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { verifyPassword, hashPassword } from "../auth/passwords.js";
import { findAdminByEmail, touchLastLogin } from "../auth/adminUsers.js";
import { areasFor } from "../auth/permissions.js";
import { MIN_PASSWORD, acceptInvite, findInvite } from "../auth/team.js";
import { logEvent } from "../events/eventsRepo.js";
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

      await createAdminSession(record.id, req, reply);
      await touchLastLogin(record.id);

      return reply.send({ admin: { id: record.id, email: record.email, name: record.name, role: record.role } });
    },
  );

  app.post("/admin/auth/logout", async (req, reply) => {
    await destroyAdminSession(req, reply);
    return reply.send({ ok: true });
  });

  app.get("/admin/auth/me", async (req, reply) => {
    const admin = await getAdminFromRequest(req);
    if (!admin) return reply.status(401).send({ error: "Admin sign-in required." });
    return reply.send({ admin, areas: areasFor(admin.role) });
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
};
