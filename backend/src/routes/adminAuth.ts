import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { verifyPassword, hashPassword } from "../auth/passwords.js";
import { findAdminByEmail, touchLastLogin } from "../auth/adminUsers.js";
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
      if (!record || !valid) {
        return reply.status(401).send({ error: GENERIC_LOGIN_ERROR });
      }

      await createAdminSession(record.id, req, reply);
      await touchLastLogin(record.id);

      return reply.send({ admin: { id: record.id, email: record.email, name: record.name } });
    },
  );

  app.post("/admin/auth/logout", async (req, reply) => {
    await destroyAdminSession(req, reply);
    return reply.send({ ok: true });
  });

  app.get("/admin/auth/me", async (req, reply) => {
    const admin = await getAdminFromRequest(req);
    if (!admin) return reply.status(401).send({ error: "Admin sign-in required." });
    return reply.send({ admin });
  });
};
