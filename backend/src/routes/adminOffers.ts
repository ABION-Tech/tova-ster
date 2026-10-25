import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { pool } from "../db/pool.js";
import { requireAdmin, requireRole } from "../auth/adminSession.js";
import { logAdmin } from "../events/eventsRepo.js";

const uuid = { type: "string", format: "uuid" } as const;
const bundleBody = {
  type: "object", additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 80 }, blurb: { type: "string", maxLength: 300 },
    productIds: { type: "array", items: uuid, minItems: 2, maxItems: 6 },
    discountPct: { type: "number", minimum: 0, maximum: 90 }, active: { type: "boolean" }, sortOrder: { type: "integer" },
  },
} as const;
const codeBody = {
  type: "object", additionalProperties: false,
  properties: {
    pct: { type: "number", exclusiveMinimum: 0, maximum: 90 }, active: { type: "boolean" }, note: { type: "string", maxLength: 200 },
    maxUses: { type: ["integer", "null"], minimum: 1 }, expiresAt: { type: ["string", "null"], format: "date-time" }, firstOrderOnly: { type: "boolean" },
  },
} as const;

export const adminOfferRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get("/admin/offers", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const [bundles, codes, sales] = await Promise.all([
      pool.query(`SELECT id, name, blurb, product_ids, discount_pct::float AS pct, active, sort_order FROM bundles WHERE kind = 'standard' ORDER BY sort_order, created_at`),
      pool.query(`SELECT code, pct::float, active, uses, max_uses, note, expires_at, first_order_only, created_at FROM discount_codes ORDER BY created_at`),
      // How many paid orders each bundle appeared in — shows the owner what earns its place.
      pool.query(`SELECT oi.bundle_id, count(DISTINCT oi.order_id)::int AS orders FROM order_items oi JOIN orders o ON o.id = oi.order_id
                  WHERE oi.bundle_id IS NOT NULL AND o.status IN ('PAID','PROCESSING','SHIPPED','DELIVERED') GROUP BY oi.bundle_id`),
    ]);
    const sold = new Map(sales.rows.map((r) => [r.bundle_id, r.orders]));
    return reply.send({ bundles: bundles.rows.map((b) => ({ ...b, orders: sold.get(b.id) ?? 0 })), codes: codes.rows });
  });

  app.post("/admin/bundles", { schema: { body: { ...bundleBody, required: ["name", "productIds", "discountPct"] } } }, async (req, reply) => {
    const admin = await requireRole(req, reply, "Manager");
    if (!admin) return;
    const b = req.body as { name: string; blurb?: string; productIds: string[]; discountPct: number; active?: boolean; sortOrder?: number };
    const r = await pool.query(
      `INSERT INTO bundles (name, blurb, product_ids, discount_pct, active, sort_order) VALUES ($1,$2,$3::uuid[],$4,$5,$6) RETURNING id`,
      [b.name, b.blurb ?? null, b.productIds, b.discountPct, b.active ?? false, b.sortOrder ?? 0],
    );
    await logAdmin(admin.id, `${admin.name} created the bundle "${b.name}" (${b.discountPct}% off)`);
    return reply.status(201).send({ id: r.rows[0].id });
  });

  app.patch("/admin/bundles/:id", { schema: { params: { type: "object", properties: { id: uuid } }, body: bundleBody } }, async (req, reply) => {
    const admin = await requireRole(req, reply, "Manager");
    if (!admin) return;
    const { id } = req.params as { id: string };
    const b = req.body as { name?: string; blurb?: string; productIds?: string[]; discountPct?: number; active?: boolean; sortOrder?: number };
    const r = await pool.query<{ name: string }>(
      `UPDATE bundles SET name = COALESCE($2, name), blurb = COALESCE($3, blurb), product_ids = COALESCE($4::uuid[], product_ids),
         discount_pct = COALESCE($5, discount_pct), active = COALESCE($6, active), sort_order = COALESCE($7, sort_order)
       WHERE id = $1 AND kind = 'standard' RETURNING name`,
      [id, b.name ?? null, b.blurb ?? null, b.productIds ?? null, b.discountPct ?? null, b.active ?? null, b.sortOrder ?? null],
    );
    if (!r.rows[0]) return reply.status(404).send({ error: "Bundle not found." });
    const what = b.active !== undefined && Object.keys(b).length === 1 ? (b.active ? "switched on" : "switched off") : "edited";
    await logAdmin(admin.id, `${admin.name} ${what} the bundle "${r.rows[0].name}"`);
    return reply.send({ ok: true });
  });

  app.delete("/admin/bundles/:id", { schema: { params: { type: "object", properties: { id: uuid } } } }, async (req, reply) => {
    const admin = await requireRole(req, reply, "Manager");
    if (!admin) return;
    const { id } = req.params as { id: string };
    // Baskets holding this bundle lose it (cart_items cascade); past orders keep their copy of the name.
    const r = await pool.query<{ name: string }>(`DELETE FROM bundles WHERE id = $1 AND kind = 'standard' RETURNING name`, [id]);
    if (!r.rows[0]) return reply.status(404).send({ error: "Bundle not found." });
    await logAdmin(admin.id, `${admin.name} deleted the bundle "${r.rows[0].name}"`);
    return reply.send({ ok: true });
  });

  app.post("/admin/codes", { schema: { body: { ...codeBody, required: ["code", "pct"], properties: { ...codeBody.properties, code: { type: "string", pattern: "^[A-Za-z0-9_-]{3,30}$" } } } } }, async (req, reply) => {
    const admin = await requireRole(req, reply, "Manager");
    if (!admin) return;
    const c = req.body as { code: string; pct: number; active?: boolean; note?: string; maxUses?: number | null; expiresAt?: string | null; firstOrderOnly?: boolean };
    const code = c.code.toUpperCase();
    const r = await pool.query(
      `INSERT INTO discount_codes (code, pct, active, note, max_uses, expires_at, first_order_only) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (code) DO NOTHING`,
      [code, c.pct, c.active ?? true, c.note ?? null, c.maxUses ?? null, c.expiresAt ?? null, c.firstOrderOnly ?? false],
    );
    if (!r.rowCount) return reply.status(409).send({ error: `${code} already exists.` });
    await logAdmin(admin.id, `${admin.name} created code ${code} (${c.pct}% off)`);
    return reply.status(201).send({ code });
  });

  app.patch("/admin/codes/:code", { schema: { body: codeBody } }, async (req, reply) => {
    const admin = await requireRole(req, reply, "Manager");
    if (!admin) return;
    const code = (req.params as { code: string }).code.toUpperCase();
    const c = req.body as { pct?: number; active?: boolean; note?: string; maxUses?: number | null; expiresAt?: string | null; firstOrderOnly?: boolean };
    const r = await pool.query(
      `UPDATE discount_codes SET pct = COALESCE($2, pct), active = COALESCE($3, active), note = COALESCE($4, note),
         max_uses = CASE WHEN $5::boolean THEN $6 ELSE max_uses END, expires_at = CASE WHEN $7::boolean THEN $8::timestamptz ELSE expires_at END,
         first_order_only = COALESCE($9, first_order_only)
       WHERE code = $1`,
      [code, c.pct ?? null, c.active ?? null, c.note ?? null, "maxUses" in c, c.maxUses ?? null, "expiresAt" in c, c.expiresAt ?? null, c.firstOrderOnly ?? null],
    );
    if (!r.rowCount) return reply.status(404).send({ error: "Code not found." });
    const what = c.active !== undefined && Object.keys(c).length === 1 ? (c.active ? "switched on" : "switched off") : "edited";
    await logAdmin(admin.id, `${admin.name} ${what} code ${code}`);
    return reply.send({ ok: true });
  });

  app.delete("/admin/codes/:code", async (req, reply) => {
    const admin = await requireRole(req, reply, "Manager");
    if (!admin) return;
    const code = (req.params as { code: string }).code.toUpperCase();
    const r = await pool.query(`DELETE FROM discount_codes WHERE code = $1`, [code]);
    if (!r.rowCount) return reply.status(404).send({ error: "Code not found." });
    await logAdmin(admin.id, `${admin.name} deleted code ${code}`);
    return reply.send({ ok: true });
  });
};
