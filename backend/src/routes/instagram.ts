import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { pool } from "../db/pool.js";
import { requireAdmin, requireRole } from "../auth/adminSession.js";
import { getSetting } from "../settings/settingsRepo.js";
import { logAdmin } from "../events/eventsRepo.js";
import { createHmac, timingSafeEqual } from "node:crypto";
import { authorizeUrl, connect, connectWithCode, disconnect, feed, oauthConfigured, status, sync, InstagramError } from "../instagram/instagramService.js";

// Signed, 15-minute "state" so only a sign-in started from our admin can connect an account.
const SECRET = () => process.env.SESSION_SECRET ?? "dev-only-secret";
function makeState(adminId: string): string {
  const body = `${adminId}.${Date.now() + 15 * 60 * 1000}`;
  return `${body}.${createHmac("sha256", SECRET()).update(`ig-state:${body}`).digest("base64url")}`;
}
function readState(state: string): string | null {
  const [adminId, exp, sig] = state.split(".");
  if (!adminId || !exp || !sig || Number(exp) < Date.now()) return null;
  const want = createHmac("sha256", SECRET()).update(`ig-state:${adminId}.${exp}`).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b) ? adminId : null;
}
const adminPage = (q: string) => `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/admin/instagram?${q}`;

export const instagramRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /** The shop's Instagram feed: live posts when connected, else the admin's chosen pictures. */
  app.get("/instagram/feed", async (req, reply) => {
    const limit = Math.min(300, Math.max(1, Number((req.query as { limit?: string }).limit) || 60));
    const insta = (await getSetting("site")).insta;
    const live = insta.source === "instagram" ? await feed(limit) : [];
    const posts = live.length ? live : insta.posts.filter(Boolean).slice(0, limit).map((m, i) => ({
      id: `manual-${i}`, type: m!.kind === "video" ? "video" : "image", src: m!.src, thumb: m!.kind === "video" ? null : m!.src,
      permalink: insta.url, caption: null, postedAt: null, children: [],
    }));
    reply.header("Cache-Control", "public, max-age=300, stale-while-revalidate=1800");
    return reply.send({ on: insta.on, handle: insta.handle, url: insta.url, live: live.length > 0, posts });
  });

  app.get("/admin/instagram", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const r = await pool.query(`SELECT id, media_type, thumbnail_url, media_url, permalink, caption, posted_at, hidden FROM instagram_media ORDER BY posted_at DESC LIMIT 300`);
    return reply.send({ status: { ...(await status()), oauthReady: oauthConfigured() }, media: r.rows });
  });

  // Step 1: the admin's "Connect Instagram" button lands here and is sent to Instagram.
  app.get("/admin/instagram/connect", async (req, reply) => {
    const admin = await requireRole(req, reply, "Manager");
    if (!admin) return;
    if (!oauthConfigured()) return reply.redirect(adminPage("ig=setup"));
    return reply.redirect(authorizeUrl(makeState(admin.id)));
  });

  // Step 2: Instagram sends the owner back here after they approve.
  app.get("/instagram/oauth/callback", async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string; error_description?: string };
    if (q.error) return reply.redirect(adminPage(`ig=denied`));
    const adminId = q.state ? readState(q.state) : null;
    if (!adminId || !q.code) return reply.redirect(adminPage("ig=expired"));
    try {
      const { username } = await connectWithCode(q.code);
      await pool.query(`INSERT INTO events (type, message, admin_id, meta) VALUES ('admin', $1, $2, '{}')`, [`Instagram @${username} connected`, adminId]);
      return reply.redirect(adminPage(`ig=connected&u=${encodeURIComponent(username)}`));
    } catch (e) {
      req.log.warn(e, "instagram connect failed");
      return reply.redirect(adminPage(`ig=failed&m=${encodeURIComponent(e instanceof Error ? e.message.slice(0, 160) : "failed")}`));
    }
  });

  app.put("/admin/instagram/token", {
    schema: { body: { type: "object", required: ["token"], additionalProperties: false, properties: { token: { type: "string", maxLength: 1000 } } } },
  }, async (req, reply) => {
    const admin = await requireRole(req, reply, "Manager");
    if (!admin) return;
    try {
      const { username } = await connect((req.body as { token: string }).token);
      await logAdmin(admin.id, `${admin.name} connected Instagram @${username}`, {});
      return reply.send({ status: await status() });
    } catch (e) {
      if (e instanceof InstagramError) return reply.status(400).send({ error: `Instagram said: ${e.message}` });
      throw e;
    }
  });

  app.delete("/admin/instagram/token", async (req, reply) => {
    const admin = await requireRole(req, reply, "Manager");
    if (!admin) return;
    await disconnect();
    await logAdmin(admin.id, `${admin.name} disconnected Instagram`, {});
    return reply.send({ status: await status() });
  });

  app.post("/admin/instagram/sync", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;
    try { const r = await sync(); return reply.send({ synced: r.count, status: await status() }); }
    catch (e) { return reply.status(502).send({ error: e instanceof Error ? e.message : "Sync failed." }); }
  });

  app.patch("/admin/instagram/media/:id", {
    schema: { body: { type: "object", required: ["hidden"], additionalProperties: false, properties: { hidden: { type: "boolean" } } } },
  }, async (req, reply) => {
    const admin = await requireRole(req, reply, "Manager");
    if (!admin) return;
    const { id } = req.params as { id: string };
    const { hidden } = req.body as { hidden: boolean };
    const r = await pool.query(`UPDATE instagram_media SET hidden = $2 WHERE id = $1`, [id, hidden]);
    if (!r.rowCount) return reply.status(404).send({ error: "Post not found." });
    await logAdmin(admin.id, `${admin.name} ${hidden ? "hid" : "showed"} an Instagram post`, { id });
    return reply.send({ ok: true });
  });
};
