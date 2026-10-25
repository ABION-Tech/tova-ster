import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { pool } from "../db/pool.js";
import { requireAdmin, requireRole } from "../auth/adminSession.js";
import { getAllSettings, saveSetting, isSettingsKey } from "../settings/settingsRepo.js";
import { validateSetting } from "../settings/validate.js";
import { logAdmin } from "../events/eventsRepo.js";
import type { SettingsKey } from "../settings/defaults.js";

// Who may change which settings group (Owner can change all).
const EDITORS: Record<SettingsKey, ("Manager" | "Support" | "Packer")[]> = {
  features: ["Manager"], delivery: ["Manager"], business: [], emails: ["Manager"], dispatch: ["Manager"], site: ["Manager"], quiz: ["Manager"],
};

export const settingsRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * Everything the storefront needs to render, in one cacheable call:
   * switches, delivery prices, homepage content, quiz, live bundles.
   * Browsers and the CDN may keep it 30s and serve it stale for 5 min while
   * refreshing, so pages load instantly and admin changes appear within a minute.
   */
  app.get("/storefront", async (_req, reply) => {
    const s = await getAllSettings();
    const bundles = await pool.query(
      `SELECT b.id, b.name, b.blurb, b.discount_pct::float AS pct,
              json_agg(json_build_object('id', p.id, 'slug', p.slug, 'name', p.name, 'price', p.base_price::float,
                'image', (SELECT url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.sort_order LIMIT 1)) ORDER BY p.sort_order) AS products
       FROM bundles b JOIN products p ON p.id = ANY(b.product_ids) AND p.status = 'active'
       WHERE b.active AND b.kind = 'standard'
       GROUP BY b.id HAVING count(*) = cardinality(b.product_ids)
       ORDER BY b.sort_order`,
    );
    const { name, email, web, instagram, address, company, vatNo, vatRegistered } = s.business;
    reply.header("Cache-Control", "public, max-age=30, stale-while-revalidate=300");
    return reply.send({
      features: s.features,
      delivery: s.delivery,
      business: { name, email, web, instagram, address, company, vatNo, vatRegistered },
      site: s.site,
      quiz: s.features.quiz.on ? s.quiz.filter((q) => q.on) : [],
      bundles: s.features.bundles.on ? bundles.rows : [],
    });
  });

  app.get("/admin/settings", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;
    const meta = await pool.query(`SELECT s.key, s.updated_at, a.name AS updated_by FROM site_settings s LEFT JOIN admin_users a ON a.id = s.updated_by`);
    return reply.send({ settings: await getAllSettings(), meta: meta.rows });
  });

  /** Email sign-ups (free guide, newsletter, checkout): totals by source plus the latest 200. */
  app.get("/admin/newsletter", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;
    const totals = await pool.query(
      `SELECT coalesce(source, 'other') AS source, count(*)::int AS total,
              count(*) FILTER (WHERE consent_at > now() - interval '7 days')::int AS week
       FROM newsletter_subscribers WHERE unsubscribed_at IS NULL GROUP BY 1 ORDER BY 2 DESC`,
    );
    const recent = await pool.query(
      `SELECT email, coalesce(source, 'other') AS source, consent_at FROM newsletter_subscribers
       WHERE unsubscribed_at IS NULL ORDER BY consent_at DESC LIMIT 200`,
    );
    return reply.send({ totals: totals.rows, recent: recent.rows });
  });

  app.put("/admin/settings/:key", async (req, reply) => {
    const { key } = req.params as { key: string };
    if (!isSettingsKey(key)) return reply.status(404).send({ error: "Unknown settings group." });
    const admin = await requireRole(req, reply, ...EDITORS[key]);
    if (!admin) return;
    const checked = validateSetting(key, (req.body as { value?: unknown })?.value);
    if ("error" in checked) return reply.status(400).send({ error: checked.error });
    const before = (await getAllSettings())[key];
    await saveSetting(key, checked.value, admin.id);
    await logAdmin(admin.id, `${admin.name} changed ${key} settings`, { key, changes: diff(before, checked.value) });
    return reply.send({ settings: await getAllSettings() });
  });
};

/** A short list of what changed, for the activity log ("features.multibuy.mode: 3for2 → 2save10"). */
function diff(a: unknown, b: unknown, path = "", out: string[] = []): string[] {
  if (out.length >= 20) return out;
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff((a as never)[k], (b as never)[k], path ? `${path}.${k}` : k, out);
  } else if (JSON.stringify(a) !== JSON.stringify(b)) {
    const show = (v: unknown) => (typeof v === "object" ? "(edited)" : String(v));
    out.push(`${path || "value"}: ${show(a)} → ${show(b)}`);
  }
  return out;
}
