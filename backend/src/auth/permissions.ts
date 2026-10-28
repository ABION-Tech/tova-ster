import type { FastifyReply, FastifyRequest } from "fastify";
import { getAdminFromRequest, type AdminRole } from "./adminSession.js";
import { twoStepRequired } from "./totp.js";

/**
 * Who may use each admin route. The Owner may always do everything, so only
 * the other roles are listed. This follows the "Roles" tab of the tracker
 * (proposal of 25 Oct 2026, to be confirmed by the client):
 *
 *   Manager  runs the shop: products, prices, offers, homepage, emails, reports.
 *   Support  answers customers: sees orders, baskets and activity, approves reviews.
 *   Packer   packs and dispatches: sees orders, updates stock.
 *
 * Any /admin route missing from this table is Owner-only, so a new route is
 * locked down until someone decides who should use it. A test checks that
 * every registered admin route has an entry here.
 */
const M: AdminRole[] = ["Manager"];
const MS: AdminRole[] = ["Manager", "Support"];
const MP: AdminRole[] = ["Manager", "Packer"];
const ALL: AdminRole[] = ["Manager", "Support", "Packer"];
const OWNER: AdminRole[] = [];

export const ROUTE_ROLES: Record<string, AdminRole[]> = {
  // Dashboard and orders
  "GET /admin/dashboard": ALL,
  "GET /admin/orders": ALL,
  "GET /admin/orders/:id": ALL,
  "PATCH /admin/orders/:id/status": MP, // Packers only pack/dispatch/deliver: checked in the route
  // Customers (Support answers customer questions here)
  "GET /admin/customers": MS,
  "GET /admin/customers/:id": MS,
  "POST /admin/customers/:id/notes": MS,
  "POST /admin/customers/:id/points": MS,
  // Baskets, activity, reports
  "GET /admin/baskets": MS,
  "GET /admin/activity": MS,
  "GET /admin/reports/channels": MS,
  "GET /admin/reports/funnel": MS,
  "GET /admin/reports/searches": MS,
  // Products and stock
  "GET /admin/products": ALL,
  "GET /admin/products/:id": ALL,
  "POST /admin/products": M,
  "PATCH /admin/products/:id": M,
  "POST /admin/products/:id/images": M,
  "DELETE /admin/products/:id/images/:imageId": M,
  "POST /admin/products/:id/variants": M,
  "PATCH /admin/products/:id/variants/:variantId": M,
  "DELETE /admin/products/:id/variants/:variantId": M,
  "POST /admin/products/:id/inventory": MP,
  // Categories
  "GET /admin/categories": ALL, // read-only list the product pages need
  "POST /admin/categories": M,
  "PATCH /admin/categories/:id": M,
  "DELETE /admin/categories/:id": M,
  // Reviews
  "GET /admin/reviews": MS,
  "PATCH /admin/reviews/:id/status": MS,
  // Offers
  "GET /admin/offers": MS,
  "POST /admin/bundles": M,
  "PATCH /admin/bundles/:id": M,
  "DELETE /admin/bundles/:id": M,
  "POST /admin/codes": M,
  "PATCH /admin/codes/:code": M,
  "DELETE /admin/codes/:code": M,
  // Homepage, growth tools, emails, business settings (per-key check in the route)
  "GET /admin/settings": M,
  "PUT /admin/settings/:key": M,
  "GET /admin/newsletter": M,
  // Instagram
  "GET /admin/instagram": M,
  "GET /admin/instagram/connect": M,
  "PUT /admin/instagram/token": M,
  "DELETE /admin/instagram/token": M,
  "POST /admin/instagram/sync": M,
  "PATCH /admin/instagram/media/:id": M,
  // Team (Owner only)
  "GET /admin/team": OWNER,
  "POST /admin/team": OWNER,
  "PATCH /admin/team/:id": OWNER,
  "POST /admin/team/:id/invite": OWNER,
  "DELETE /admin/team/:id": OWNER,
  "POST /admin/team/:id/reset-2fa": OWNER,
};

/** Routes any signed-in team member, or anyone, may call. */
const OPEN = new Set(["POST /admin/auth/login", "POST /admin/auth/accept-invite", "GET /admin/auth/invite", "POST /admin/auth/verify-code"]);
const ANY_ADMIN = new Set(["POST /admin/auth/logout", "GET /admin/auth/me", "GET /admin/auth/2fa", "POST /admin/auth/2fa/setup", "POST /admin/auth/2fa/confirm", "POST /admin/auth/2fa/off"]);

/** Admin areas (menu items) and the route that decides whether a role sees them. */
export const AREAS: Record<string, string> = {
  dashboard: "GET /admin/dashboard",
  orders: "GET /admin/orders",
  customers: "GET /admin/customers",
  baskets: "GET /admin/baskets",
  products: "GET /admin/products",
  categories: "POST /admin/categories",
  reviews: "GET /admin/reviews",
  homepage: "PUT /admin/settings/:key",
  growth: "GET /admin/newsletter",
  offers: "GET /admin/offers",
  emails: "PUT /admin/settings/:key",
  quiz: "PUT /admin/settings/:key",
  activity: "GET /admin/activity",
  instagram: "GET /admin/instagram",
  team: "GET /admin/team",
};

export function roleMay(role: AdminRole, routeKey: string): boolean {
  if (role === "Owner") return true;
  return (ROUTE_ROLES[routeKey] ?? OWNER).includes(role);
}

export function areasFor(role: AdminRole): string[] {
  return Object.entries(AREAS).filter(([, key]) => roleMay(role, key)).map(([area]) => area);
}

export function isGuardedAdminRoute(key: string): boolean {
  const [, path] = key.split(" ");
  return path.startsWith("/admin") && !OPEN.has(key) && !ANY_ADMIN.has(key);
}

/** onRequest hook for every route: signs in and role-checks anything under /admin. */
export async function adminGate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const path = req.routeOptions.url;
  if (!path || !path.startsWith("/admin")) return;
  const method = req.method === "HEAD" ? "GET" : req.method;
  const key = `${method} ${path}`;
  if (OPEN.has(key)) return;
  const admin = await getAdminFromRequest(req);
  if (!admin) {
    reply.status(401).send({ error: "Admin sign-in required." });
    return reply;
  }
  if (ANY_ADMIN.has(key)) return;
  if (twoStepRequired() && !admin.twoStep) {
    reply.status(403).send({ error: "Set up two-step sign-in first.", code: "two_step_required" });
    return reply;
  }
  if (!(key in ROUTE_ROLES)) req.log.warn({ route: key }, "Admin route has no permission entry; Owner only.");
  if (!roleMay(admin.role, key)) {
    reply.status(403).send({ error: `Your role (${admin.role}) can't do this. Ask the owner.` });
    return reply;
  }
}
