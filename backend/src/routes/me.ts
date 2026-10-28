import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { pool } from "../db/pool.js";
import { requireUser } from "../auth/session.js";
import { logEvent } from "../events/eventsRepo.js";
import { getSetting } from "../settings/settingsRepo.js";
import { emailService } from "../services/email/index.js";

const uuid = { type: "string", format: "uuid" } as const;

/** The signed-in customer's own subscriptions and points, plus the public newsletter sign-up. */
export const meRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get("/me/subscriptions", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const r = await pool.query(
      `SELECT s.id, s.product_name, s.quantity, s.interval_months, s.unit_price::float, s.status, s.next_charge_at,
              p.slug, (SELECT url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.sort_order LIMIT 1) AS image
       FROM subscriptions s LEFT JOIN products p ON p.id = s.product_id
       WHERE s.user_id = $1 AND s.status <> 'cancelled'
       ORDER BY s.created_at DESC`,
      [user.id],
    );
    return reply.send({ subscriptions: r.rows });
  });

  // Skip / pause / resume / cancel, no phone call needed. Stripe Billing is
  // kept in step by the subscription sync (Day 3); this is the source of truth.
  app.patch("/me/subscriptions/:id", {
    schema: {
      params: { type: "object", properties: { id: uuid } },
      body: { type: "object", required: ["action"], additionalProperties: false, properties: { action: { type: "string", enum: ["skip", "pause", "resume", "cancel"] } } },
    },
  }, async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const { action } = req.body as { action: "skip" | "pause" | "resume" | "cancel" };
    const sql = {
      skip: `UPDATE subscriptions SET next_charge_at = next_charge_at + make_interval(months => interval_months) WHERE id = $1 AND user_id = $2 AND status = 'active' RETURNING product_name`,
      pause: `UPDATE subscriptions SET status = 'paused' WHERE id = $1 AND user_id = $2 AND status = 'active' RETURNING product_name`,
      resume: `UPDATE subscriptions SET status = 'active', next_charge_at = GREATEST(next_charge_at, now() + interval '3 days') WHERE id = $1 AND user_id = $2 AND status = 'paused' RETURNING product_name`,
      cancel: `UPDATE subscriptions SET status = 'cancelled' WHERE id = $1 AND user_id = $2 AND status IN ('active', 'paused', 'past_due') RETURNING product_name`,
    }[action];
    const r = await pool.query<{ product_name: string }>(sql, [id, user.id]);
    if (!r.rows[0]) return reply.status(409).send({ error: "That subscription can't be changed right now. Refresh and try again." });
    const verb = { skip: "Skipped the next delivery of", pause: "Paused", resume: "Resumed", cancel: "Cancelled" }[action];
    await logEvent({ type: "subscription", message: `${verb} ${r.rows[0].product_name} subscription`, userId: user.id, meta: { subscriptionId: id, action } });
    return reply.send({ ok: true });
  });

  app.get("/me/points", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const [bal, hist] = await Promise.all([
      pool.query<{ points_balance: number }>(`SELECT points_balance FROM users WHERE id = $1`, [user.id]),
      pool.query(`SELECT delta, reason, created_at FROM points_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`, [user.id]),
    ]);
    return reply.send({ balance: bal.rows[0]?.points_balance ?? 0, history: hist.rows });
  });

  // Newsletter for people without an account. Consent is explicit (the form's
  // tick box is required); re-signing up after unsubscribing re-consents.
  app.post("/newsletter", {
    config: { rateLimit: { max: 5, timeWindow: "10 minutes" } },
    schema: { body: { type: "object", required: ["email", "consent"], additionalProperties: false, properties: {
      email: { type: "string", maxLength: 200 }, consent: { type: "boolean", const: true }, source: { type: "string", maxLength: 40 },
    } } },
  }, async (req, reply) => {
    const { email, source } = req.body as { email: string; source?: string };
    const e = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return reply.status(400).send({ error: "Please enter a valid email address." });
    await pool.query(
      `INSERT INTO newsletter_subscribers (email, source) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET consent_at = now(), unsubscribed_at = NULL, source = COALESCE(EXCLUDED.source, newsletter_subscribers.source)`,
      [e, source ?? null],
    );
    await pool.query(`UPDATE users SET unsubscribed_at = NULL WHERE lower(email) = $1`, [e]); // signing up again re-consents
    await logEvent({ type: "newsletter", message: "Signed up to emails", meta: { source: source ?? null } });
    return reply.status(204).send();
  });

  // Growth tool: free download for an email. Consent is required (the tick
  // box); the guide is shown straight away and emailed so it isn't lost.
  app.post("/freebie", {
    config: { rateLimit: { max: 5, timeWindow: "10 minutes" } },
    schema: { body: { type: "object", required: ["email", "consent"], additionalProperties: false, properties: {
      email: { type: "string", maxLength: 200 }, consent: { type: "boolean", const: true }, where: { type: "string", maxLength: 40 },
    } } },
  }, async (req, reply) => {
    const f = await getSetting("features");
    if (!f.freebie.on) return reply.status(404).send({ error: "This offer has ended." });
    const { email, where } = req.body as { email: string; where?: string };
    const e = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return reply.status(400).send({ error: "Please enter a valid email address." });
    await pool.query(
      `INSERT INTO newsletter_subscribers (email, source) VALUES ($1, 'freebie')
       ON CONFLICT (email) DO UPDATE SET consent_at = now(), unsubscribed_at = NULL`,
      [e],
    );
    await pool.query(`UPDATE users SET unsubscribed_at = NULL WHERE lower(email) = $1`, [e]);
    const appUrl = (process.env.APP_URL ?? "https://tova-ster.com").replace(/\/$/, "");
    const link = /^https:\/\//.test(f.freebie.fileUrl) ? f.freebie.fileUrl : `${appUrl}${f.freebie.fileUrl}`;
    const code = f.freebie.giveCode && f.welcome.on ? f.welcome.code : null;
    emailService.send({ to: e, subject: "Your free Tova-Ster guide", template: "freebie", data: { link, title: f.freebie.title, code, pct: f.welcome.pct } })
      .catch((err) => req.log.error(err, "freebie email failed"));
    await logEvent({ type: "newsletter", message: "Got the free guide", meta: { source: "freebie", where: where ?? null } });
    return reply.send({ downloadUrl: f.freebie.fileUrl, code, pct: code ? f.welcome.pct : null });
  });
};
