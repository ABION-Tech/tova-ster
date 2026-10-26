import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { pool } from "../db/pool.js";
import { requireRole, type AdminRole } from "../auth/adminSession.js";
import { ROLES, activeOwnerCount, cleanEmail, createInvite, listTeam } from "../auth/team.js";
import { logEvent, maskEmail } from "../events/eventsRepo.js";
import { emailService } from "../services/email/index.js";

/**
 * Team page (Owner only, also enforced by auth/permissions.ts):
 * invite people, change roles, send a new password link, remove access.
 * Safeguards: there is always at least one active Owner, and a removed
 * person is signed out at once. Every change is written to the activity log.
 */
const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";

export const adminTeamRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get("/admin/team", async (req, reply) => {
    const admin = await requireRole(req, reply);
    if (!admin) return;
    return reply.send({ team: await listTeam(), roles: ROLES, me: admin.id });
  });

  app.post("/admin/team", async (req, reply) => {
    const admin = await requireRole(req, reply);
    if (!admin) return;
    const b = (req.body ?? {}) as { name?: string; email?: string; role?: string };
    const name = String(b.name ?? "").trim().slice(0, 80);
    const email = cleanEmail(b.email);
    const role = b.role as AdminRole;
    if (!name) return reply.status(400).send({ error: "Add the person's name." });
    if (!email) return reply.status(400).send({ error: "Add a valid email address." });
    if (!ROLES.includes(role)) return reply.status(400).send({ error: "Choose a role." });
    const exists = await pool.query(`SELECT id, active FROM admin_users WHERE lower(email) = $1`, [email]);
    if (exists.rows[0]?.active) return reply.status(409).send({ error: "That email is already on the team." });

    let id: string;
    if (exists.rows[0]) {
      // Someone removed earlier is being invited back: reactivate with the new role, password reset.
      id = exists.rows[0].id;
      await pool.query(`UPDATE admin_users SET name = $2, role = $3, active = true, password_hash = NULL WHERE id = $1`, [id, name, role]);
    } else {
      const r = await pool.query<{ id: string }>(
        `INSERT INTO admin_users (email, name, role, active) VALUES ($1, $2, $3, true) RETURNING id`,
        [email, name, role],
      );
      id = r.rows[0].id;
    }
    const invite = await createInvite(id, admin.id, appUrl());
    const sent = await sendInvite(email, name, role, admin.name, invite.link);
    await logEvent({ type: "admin", adminId: admin.id, message: `${admin.name} invited ${name} as ${role}`, meta: { action: "team_invite", memberId: id, to: maskEmail(email), role } });
    return reply.status(201).send({ id, inviteLink: invite.link, expiresAt: invite.expiresAt, emailed: sent });
  });

  app.patch("/admin/team/:id", async (req, reply) => {
    const admin = await requireRole(req, reply);
    if (!admin) return;
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { role?: string; name?: string };
    const cur = await pool.query<{ name: string; role: AdminRole; active: boolean }>(`SELECT name, role, active FROM admin_users WHERE id = $1`, [id]);
    const m = cur.rows[0];
    if (!m || !m.active) return reply.status(404).send({ error: "Team member not found." });

    const role = b.role === undefined ? m.role : (b.role as AdminRole);
    if (!ROLES.includes(role)) return reply.status(400).send({ error: "Choose a role." });
    const name = b.name === undefined ? m.name : String(b.name).trim().slice(0, 80);
    if (!name) return reply.status(400).send({ error: "Name can't be empty." });
    if (m.role === "Owner" && role !== "Owner" && (await activeOwnerCount()) <= 1) {
      return reply.status(409).send({ error: "The shop needs at least one Owner. Make someone else Owner first." });
    }
    await pool.query(`UPDATE admin_users SET role = $2, name = $3 WHERE id = $1`, [id, role, name]);
    if (role !== m.role) {
      await logEvent({ type: "admin", adminId: admin.id, message: `${admin.name} changed ${name}'s role from ${m.role} to ${role}`, meta: { action: "team_role", memberId: id, from: m.role, to: role } });
    }
    return reply.send({ ok: true });
  });

  app.post("/admin/team/:id/invite", async (req, reply) => {
    const admin = await requireRole(req, reply);
    if (!admin) return;
    const { id } = req.params as { id: string };
    const cur = await pool.query<{ name: string; email: string; role: AdminRole; active: boolean }>(`SELECT name, email, role, active FROM admin_users WHERE id = $1`, [id]);
    const m = cur.rows[0];
    if (!m || !m.active) return reply.status(404).send({ error: "Team member not found." });
    const invite = await createInvite(id, admin.id, appUrl());
    const sent = await sendInvite(m.email, m.name, m.role, admin.name, invite.link);
    await logEvent({ type: "admin", adminId: admin.id, message: `${admin.name} sent ${m.name} a new password link`, meta: { action: "team_link", memberId: id } });
    return reply.send({ inviteLink: invite.link, expiresAt: invite.expiresAt, emailed: sent });
  });

  app.delete("/admin/team/:id", async (req, reply) => {
    const admin = await requireRole(req, reply);
    if (!admin) return;
    const { id } = req.params as { id: string };
    const cur = await pool.query<{ name: string; role: AdminRole; active: boolean }>(`SELECT name, role, active FROM admin_users WHERE id = $1`, [id]);
    const m = cur.rows[0];
    if (!m || !m.active) return reply.status(404).send({ error: "Team member not found." });
    if (m.role === "Owner" && (await activeOwnerCount()) <= 1) {
      return reply.status(409).send({ error: "You can't remove the last Owner." });
    }
    // Kept (inactive) rather than deleted, so their past actions stay in the records.
    await pool.query(`UPDATE admin_users SET active = false WHERE id = $1`, [id]);
    await pool.query(`DELETE FROM admin_sessions WHERE admin_user_id = $1`, [id]);
    await pool.query(`UPDATE admin_invites SET used_at = now() WHERE admin_user_id = $1 AND used_at IS NULL`, [id]);
    await logEvent({ type: "admin", adminId: admin.id, message: `${admin.name} removed ${m.name} (${m.role}) from the team`, meta: { action: "team_remove", memberId: id, role: m.role } });
    return reply.send({ ok: true, signedOut: true });
  });
};

async function sendInvite(to: string, name: string, role: string, invitedBy: string, link: string): Promise<boolean> {
  try {
    await emailService.send({ to, subject: "You're invited to the Tova-Ster admin", template: "admin_invite", data: { name, role, invitedBy, link } });
    return Boolean(process.env.RESEND_API_KEY);
  } catch {
    return false;
  }
}
