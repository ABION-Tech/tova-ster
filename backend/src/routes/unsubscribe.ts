import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { readUnsubscribeToken, unsubscribe } from "../services/email/unsubscribe.js";
import { maskEmail } from "../events/eventsRepo.js";

/**
 * Unsubscribing from marketing emails.
 *  - GET  /unsubscribe?t=…          which address the link is for (masked), for the confirm page
 *  - POST /unsubscribe {t}          the shop's "Unsubscribe" button
 *  - POST /unsubscribe/one-click?t= mail apps' own button (RFC 8058, form-encoded body)
 */
export const unsubscribeRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Mail apps send "List-Unsubscribe=One-Click" form-encoded; only this plugin accepts that type.
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => done(null, body));
  const limit = { rateLimit: { max: 20, timeWindow: "10 minutes" } };
  const bad = { error: "This unsubscribe link isn't valid. Please email info@tova-ster.com and we'll take you off the list." };

  app.get("/unsubscribe", { config: limit, schema: { querystring: { type: "object", required: ["t"], properties: { t: { type: "string", maxLength: 400 } } } } }, async (req, reply) => {
    const email = readUnsubscribeToken((req.query as { t: string }).t);
    if (!email) return reply.status(400).send(bad);
    return reply.send({ email: maskEmail(email) });
  });

  app.post("/unsubscribe", { config: limit, schema: { body: { type: "object", required: ["t"], additionalProperties: false, properties: { t: { type: "string", maxLength: 400 } } } } }, async (req, reply) => {
    const email = readUnsubscribeToken((req.body as { t: string }).t);
    if (!email) return reply.status(400).send(bad);
    await unsubscribe(email, "link");
    return reply.send({ ok: true, email: maskEmail(email) });
  });

  app.post("/unsubscribe/one-click", { config: limit, schema: { querystring: { type: "object", required: ["t"], properties: { t: { type: "string", maxLength: 400 } } } } }, async (req, reply) => {
    const email = readUnsubscribeToken((req.query as { t: string }).t);
    if (!email) return reply.status(400).send(bad);
    await unsubscribe(email, "mail-app");
    return reply.status(200).send({ ok: true });
  });
};
