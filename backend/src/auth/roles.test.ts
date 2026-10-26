// Role tests: every admin route is tried as Owner, Manager, Support and Packer,
// and must be refused (403) exactly when the permission table says so.
// Needs a migrated, seeded database: DATABASE_URL=... npm run test:roles
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../app.js";
import { pool } from "../db/pool.js";
import { generateToken } from "./tokens.js";
import { ROUTE_ROLES, isGuardedAdminRoute, roleMay, areasFor } from "./permissions.js";
import type { AdminRole } from "./adminSession.js";

const app = await buildApp({ logger: false, rateLimitMax: 100000 });
await app.ready();
const routes = (app as unknown as { routeList: string[] }).routeList;
const tag = `roletest-${Date.now()}`;
const cookies: Record<AdminRole, string> = {} as Record<AdminRole, string>;
const ids: Record<AdminRole, string> = {} as Record<AdminRole, string>;

for (const role of ["Owner", "Manager", "Support", "Packer"] as AdminRole[]) {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, name, role, active, password_hash) VALUES ($1, $2, $3, true, 'x') RETURNING id`,
    [`${tag}-${role.toLowerCase()}@example.com`, `${role} Test`, role],
  );
  ids[role] = r.rows[0].id;
  const { raw, hash } = generateToken();
  await pool.query(`INSERT INTO admin_sessions (admin_user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')`, [ids[role], hash]);
  cookies[role] = `admin_session=${raw}`;
}

after(async () => {
  await pool.query(`DELETE FROM admin_users WHERE email LIKE $1`, [`${tag}%`]);
  await app.close();
  await pool.end();
});

const fill = (path: string) => path.replace(/:code/g, "NOPE-CODE").replace(/:key/g, "nokey").replace(/:\w+/g, () => randomUUID());

test("every admin route has a permission entry", () => {
  const missing = routes.filter((k) => isGuardedAdminRoute(k) && !(k in ROUTE_ROLES));
  assert.deepEqual(missing, []);
});

test("signed-out requests to admin routes get 401", async () => {
  for (const key of routes.filter(isGuardedAdminRoute)) {
    const [method, path] = key.split(" ");
    const res = await app.inject({ method: method as "GET", url: fill(path), payload: method === "GET" || method === "DELETE" ? undefined : {} });
    assert.equal(res.statusCode, 401, `${key} without sign-in`);
  }
});

test("each role is refused exactly where the table says", async () => {
  const skip = new Set(["POST /admin/instagram/sync", "GET /admin/instagram/connect"]); // would call Instagram
  let checked = 0;
  for (const key of routes.filter(isGuardedAdminRoute)) {
    const [method, path] = key.split(" ");
    for (const role of ["Owner", "Manager", "Support", "Packer"] as AdminRole[]) {
      const allowed = roleMay(role, key);
      if (allowed && skip.has(key)) continue;
      const res = await app.inject({
        method: method as "GET", url: fill(path), headers: { cookie: cookies[role] },
        payload: method === "GET" || method === "DELETE" ? undefined : {},
      });
      if (allowed) assert.notEqual(res.statusCode, 403, `${role} should be allowed: ${key} (${res.body.slice(0, 120)})`);
      else assert.equal(res.statusCode, 403, `${role} should be refused: ${key}`);
      assert.notEqual(res.statusCode, 401, `${role} signed in: ${key}`);
      checked++;
    }
  }
  assert.ok(checked > 150, `checked ${checked}`);
});

test("menu areas follow the table", () => {
  assert.deepEqual(areasFor("Packer"), ["dashboard", "orders", "products"]);
  assert.ok(areasFor("Owner").includes("team"));
  assert.ok(!areasFor("Manager").includes("team"));
  assert.deepEqual(areasFor("Support"), ["dashboard", "orders", "customers", "baskets", "products", "reviews"]);
});

test("a Packer can't cancel an order", async () => {
  const res = await app.inject({ method: "PATCH", url: `/admin/orders/${randomUUID()}/status`, headers: { cookie: cookies.Packer }, payload: { status: "CANCELLED" } });
  assert.equal(res.statusCode, 403);
});

test("team: invite, accept, role change, last-Owner safeguard, removal signs out", async () => {
  const owner = { cookie: cookies.Owner };
  // Invite a packer
  const email = `${tag}-new@example.com`;
  const inv = await app.inject({ method: "POST", url: "/admin/team", headers: owner, payload: { name: "New Packer", email, role: "Packer" } });
  assert.equal(inv.statusCode, 201, inv.body);
  const { id, inviteLink } = inv.json() as { id: string; inviteLink: string };
  const token = new URL(inviteLink).searchParams.get("token")!;
  // Can't sign in before choosing a password
  const early = await app.inject({ method: "POST", url: "/admin/auth/login", payload: { email, password: "whatever-password-123" } });
  assert.equal(early.statusCode, 401);
  // Link check, short password refused, then accepted and signed in
  assert.equal((await app.inject({ method: "GET", url: `/admin/auth/invite?token=${token}` })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: "/admin/auth/accept-invite", payload: { token, password: "short" } })).statusCode, 400);
  const ok = await app.inject({ method: "POST", url: "/admin/auth/accept-invite", payload: { token, password: "a-strong-password-1" } });
  assert.equal(ok.statusCode, 200, ok.body);
  const cookie = String(ok.headers["set-cookie"]).split(";")[0];
  const me = await app.inject({ method: "GET", url: "/admin/auth/me", headers: { cookie } });
  assert.deepEqual((me.json() as { areas: string[] }).areas, ["dashboard", "orders", "products"]);
  // The link only works once
  assert.equal((await app.inject({ method: "POST", url: "/admin/auth/accept-invite", payload: { token, password: "another-password-2" } })).statusCode, 404);
  // A Manager can't manage the team
  assert.equal((await app.inject({ method: "PATCH", url: `/admin/team/${id}`, headers: { cookie: cookies.Manager }, payload: { role: "Owner" } })).statusCode, 403);
  // Role change is recorded
  assert.equal((await app.inject({ method: "PATCH", url: `/admin/team/${id}`, headers: owner, payload: { role: "Support" } })).statusCode, 200);
  const ev = await pool.query(`SELECT 1 FROM events WHERE type = 'admin' AND meta->>'action' = 'team_role' AND meta->>'memberId' = $1`, [id]);
  assert.equal(ev.rowCount, 1);
  // Removal signs them out at once
  assert.equal((await app.inject({ method: "DELETE", url: `/admin/team/${id}`, headers: owner })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: "/admin/auth/me", headers: { cookie } })).statusCode, 401);
  assert.equal((await app.inject({ method: "POST", url: "/admin/auth/login", payload: { email, password: "a-strong-password-1" } })).statusCode, 401);
  // Last-Owner safeguard: with every other Owner disabled, the test Owner can't be demoted or removed
  const others = await pool.query<{ id: string }>(`UPDATE admin_users SET active = false WHERE role = 'Owner' AND active AND id <> $1 RETURNING id`, [ids.Owner]);
  try {
    assert.equal((await app.inject({ method: "PATCH", url: `/admin/team/${ids.Owner}`, headers: owner, payload: { role: "Manager" } })).statusCode, 409);
    assert.equal((await app.inject({ method: "DELETE", url: `/admin/team/${ids.Owner}`, headers: owner })).statusCode, 409);
  } finally {
    if (others.rowCount) await pool.query(`UPDATE admin_users SET active = true WHERE id = ANY($1)`, [others.rows.map((r) => r.id)]);
  }
});
