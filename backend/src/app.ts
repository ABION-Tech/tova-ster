import Fastify from "fastify";
import { adminGate } from "./auth/permissions.js";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { cartRoutes } from "./routes/cart.js";
import { profileRoutes } from "./routes/profile.js";
import { addressRoutes } from "./routes/addresses.js";
import { adminAuthRoutes } from "./routes/adminAuth.js";
import { adminCategoryRoutes } from "./routes/adminCategories.js";
import { adminProductRoutes } from "./routes/adminProducts.js";
import { adminOrderRoutes } from "./routes/adminOrders.js";
import { adminDashboardRoutes } from "./routes/adminDashboard.js";
import { adminBasketRoutes } from "./routes/adminBaskets.js";
import { adminTeamRoutes } from "./routes/adminTeam.js";
import { adminCustomerRoutes } from "./routes/adminCustomers.js";
import { adminReviewRoutes } from "./routes/adminReviews.js";
import { deliveryRoutes } from "./routes/delivery.js";
import { reviewRoutes } from "./routes/reviews.js";
import { publicCategoryRoutes } from "./routes/categories.js";
import { publicProductRoutes } from "./routes/products.js";
import { orderRoutes } from "./routes/orders.js";
import { paymentRoutes } from "./routes/payments.js";
import { settingsRoutes } from "./routes/settings.js";
import { adminOfferRoutes } from "./routes/adminOffers.js";
import { activityRoutes } from "./routes/activity.js";
import { catalogueRoutes } from "./routes/catalogue.js";
import { unsubscribeRoutes } from "./routes/unsubscribe.js";
import { meRoutes } from "./routes/me.js";
import { instagramRoutes } from "./routes/instagram.js";

export async function buildApp(opts: { logger?: boolean; rateLimitMax?: number } = {}) {
const app = Fastify({ logger: opts.logger ?? true });

// Every route as "METHOD /path", so tests can check each admin route has a permission entry.
const routeList: string[] = [];
app.addHook("onRoute", (r) => {
  for (const m of [r.method].flat()) if (m !== "HEAD") routeList.push(`${m} ${r.url}`);
});
app.decorate("routeList", routeList);

await app.register(cors, {
  // Comma-separated: e.g. "https://tova-ster.com,https://www.tova-ster.com".
  origin: (process.env.CORS_ORIGIN ?? "http://localhost:3000").split(",").map((o) => o.trim()),
  // Cookies (session + guest cart) cross the Vercel/Railway origin split,
  // so this can't be the default false — and origin above must stay an
  // explicit value, never "*", for credentialed requests to be allowed.
  credentials: true,
});

// Session and guest-cart cookies are signed nowhere — they carry opaque
// bearer tokens whose hash is checked against the database (see
// src/auth/session.ts) — so no cookie secret is needed here.
await app.register(cookie);

// Global default; auth routes override with tighter per-route limits
// (see src/routes/auth.ts). In-memory store: fine for a single Railway
// instance, but won't share state across a future horizontally-scaled
// deployment — swap in a Redis store then.
await app.register(rateLimit, {
  max: opts.rateLimitMax ?? 100,
  timeWindow: "1 minute",
});

// Product image uploads (admin only). 8MB cap: comfortably above a
// phone-camera product photo, well below "someone uploaded a video".
await app.register(multipart, {
  limits: { fileSize: 8 * 1024 * 1024 },
});

// Every /admin route passes the role check in auth/permissions.ts first.
app.addHook("onRequest", adminGate); // before body checks, so signed-out or refused requests learn nothing

await app.register(healthRoutes);
await app.register(authRoutes);
await app.register(cartRoutes);
await app.register(orderRoutes);
await app.register(paymentRoutes);
await app.register(profileRoutes);
await app.register(addressRoutes);
await app.register(adminAuthRoutes);
await app.register(adminCategoryRoutes);
await app.register(adminProductRoutes);
await app.register(adminOrderRoutes);
await app.register(adminDashboardRoutes);
await app.register(adminBasketRoutes);
await app.register(adminTeamRoutes);
await app.register(adminCustomerRoutes);
await app.register(adminReviewRoutes);
await app.register(deliveryRoutes);
await app.register(reviewRoutes);
await app.register(publicCategoryRoutes);
await app.register(publicProductRoutes);
await app.register(settingsRoutes);
await app.register(adminOfferRoutes);
await app.register(activityRoutes);
await app.register(catalogueRoutes);
await app.register(meRoutes);
await app.register(unsubscribeRoutes);
await app.register(instagramRoutes);

return app;
}
