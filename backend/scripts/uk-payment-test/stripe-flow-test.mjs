import * as require_fs from "node:fs";
import http from "node:http";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import pg from "pg";
const db = new pg.Pool({ connectionString: "postgres://postgres@localhost:5433/tovaster" });

const SECRET = "whsec_it";
let sessions = {}; let created = [];
const stripe = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.method === "POST" && req.url === "/v1/checkout/sessions") {
      const p = new URLSearchParams(b); const id = "cs_test_" + (created.length + 1);
      created.push(Object.fromEntries(p));
      sessions[id] = { id, url: "https://checkout.stripe.test/" + id, status: "open", payment_status: "unpaid", amount_total: Number(p.get("line_items[0][price_data][unit_amount]")), currency: p.get("line_items[0][price_data][currency]"), client_reference_id: p.get("client_reference_id") };
      return res.end(JSON.stringify(sessions[id]));
    }
    if (req.method === "GET" && req.url.startsWith("/v1/checkout/sessions/")) {
      const s = sessions[req.url.split("/").pop()]; return res.end(JSON.stringify(s ?? { error: { message: "nope" } }));
    }
    if (req.method === "POST" && req.url === "/_set") { const { id, ...patch } = JSON.parse(b); Object.assign(sessions[id], patch); return res.end("{}"); }
    res.statusCode = 404; res.end("{}");
  });
}).listen(4567);

const env = { ...process.env, PORT: "4010", STRIPE_API_BASE: "http://localhost:4567/v1", STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: SECRET, APP_URL: "http://localhost:3000", CORS_ORIGIN: "http://localhost:3000", DATABASE_URL: "postgres://postgres@localhost:5433/tovaster", SESSION_SECRET: "s".repeat(32), NODE_ENV: "development" };
const srv = { kill(){} };
const B = "http://localhost:4010";
for (let i = 0; i < 40; i++) { try { if ((await fetch(B + "/health")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }

class Client { jar = {}; async req(m, p, body, headers = {}) {
  let r; for (let attempt = 0; attempt < 3; attempt++) { try { r = await fetch(B + p, { method: m, headers: { "content-type": "application/json", cookie: Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join("; "), ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) }); break; } catch (e) { if (attempt === 2) throw e; await new Promise((x) => setTimeout(x, 200)); } }
  for (const c of r.headers.getSetCookie?.() ?? []) { const [kv] = c.split(";"); const [k, v] = kv.split("="); this.jar[k] = v; }
  let j = null; try { j = await r.json(); } catch {} return { status: r.status, body: j }; } }

const sign = (obj) => { const raw = JSON.stringify(obj); const t = Math.floor(Date.now() / 1000); return [raw, { "stripe-signature": `t=${t},v1=${createHmac("sha256", SECRET).update(`${t}.${raw}`).digest("hex")}` }]; };
const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log(ok ? "PASS" : "FAIL", name, extra); };

async function newOrder(postcode = "SW1A 1AA", qty = 1) {
  const c = new Client();
  const prods = await c.req("GET", "/products"); const list = prods.body.products ?? prods.body.items ?? prods.body;
  const p = list.find((x) => x.status === "active" || !x.status) ?? list[0];
  const add = await c.req("POST", "/cart/items", { productId: p.id, quantity: qty });
  const o = await c.req("POST", "/orders", { customer: { name: "T Test", email: "t@example.com", phone: "07000000000" }, delivery: { recipientName: "T Test", phone: "07000000000", line1: "1 High St", city: "London", postalCode: postcode } });
  return { c, add, o, p };
}
async function orderStatus(c, num) { const r = await db.query("SELECT status FROM orders WHERE order_number=$1", [num]); return r.rows[0]?.status; }

try {
  // 1. order creation: UK postcode required, delivery by zone, GBP
  const bad = await newOrder("12345"); check("rejects non-UK postcode", bad.o.status >= 400, JSON.stringify(bad.o.body));
  const a = await newOrder("IV1 1AA"); console.log("order create:", a.o.status, JSON.stringify(a.o.body).slice(0, 200));
  const ord = a.o.body.order ?? a.o.body; const total = Number(ord.total);
  const pay = await a.c.req("POST", `/orders/${ord.id}/pay`, {}); check("pay returns Stripe checkoutUrl", pay.status === 200 && pay.body.checkoutUrl?.includes("checkout.stripe.test"), JSON.stringify(pay.body));
  check("Stripe session amount == order total (pence), GBP", created[0] && Number(created[0]["line_items[0][price_data][unit_amount]"]) === Math.round(total * 100) && created[0]["line_items[0][price_data][currency]"] === "gbp");
  const ref = pay.body.reference; check("reference is the Stripe session id", ref === "cs_test_1", ref);

  // 2. webhook security + integrity
  const evt = { type: "checkout.session.completed", data: { object: { id: ref } } };
  const un = await a.c.req("POST", "/webhooks/stripe", JSON.stringify(evt)); check("unsigned webhook rejected (401)", un.status === 401);
  const [raw, h] = sign(evt);
  let r = await a.c.req("POST", "/webhooks/stripe", raw, h); check("signed webhook while Stripe says unpaid: acknowledged, order NOT paid", r.status === 200 && (await orderStatus(a.c, ord.orderNumber)) === "PENDING_PAYMENT", await orderStatus(a.c, ord.orderNumber));
  await fetch("http://localhost:4567/_set", { method: "POST", body: JSON.stringify({ id: ref, payment_status: "paid", status: "complete" }) });
  r = await a.c.req("POST", "/webhooks/stripe", raw, h); const st = await orderStatus(a.c, ord.orderNumber); check("verified paid -> order PAID", r.status === 200 && st === "PAID", st);
  r = await a.c.req("POST", "/webhooks/stripe", raw, h); check("replayed webhook is a no-op (duplicate)", r.status === 200 && r.body?.duplicate === true, JSON.stringify(r.body));

  const row = (await db.query("SELECT o.vat_total, o.currency, o.delivery_fee, p.provider, p.status FROM orders o JOIN payments p ON p.order_id=o.id WHERE o.order_number=$1", [ord.orderNumber])).rows[0];
  check("order stored as GBP with VAT, Highlands fee 7.99, provider stripe", row.currency === "GBP" && Number(row.vat_total) > 0 && Number(row.delivery_fee) === 7.99 && row.provider === "stripe" && row.status === "success", JSON.stringify(row));

  // 3. tampered amount
  const m = await newOrder("SW1A 1AA"); const mo = m.o.body.order ?? m.o.body; const mp = await m.c.req("POST", `/orders/${mo.id}/pay`, {});
  await fetch("http://localhost:4567/_set", { method: "POST", body: JSON.stringify({ id: mp.body.reference, payment_status: "paid", status: "complete", amount_total: 1 }) });
  const [raw2, h2] = sign({ type: "checkout.session.completed", data: { object: { id: mp.body.reference } } });
  await m.c.req("POST", "/webhooks/stripe", raw2, h2); const st2 = await orderStatus(m.c, mo.orderNumber); check("wrong amount -> order NOT paid", st2 === "PENDING_PAYMENT", st2);

  // 4. wrong currency
  const w = await newOrder("SW1A 1AA"); const wo = w.o.body.order ?? w.o.body; const wp = await w.c.req("POST", `/orders/${wo.id}/pay`, {});
  await fetch("http://localhost:4567/_set", { method: "POST", body: JSON.stringify({ id: wp.body.reference, payment_status: "paid", status: "complete", currency: "usd" }) });
  const [raw3, h3] = sign({ type: "checkout.session.completed", data: { object: { id: wp.body.reference } } });
  await w.c.req("POST", "/webhooks/stripe", raw3, h3); const st3 = await orderStatus(w.c, wo.orderNumber); check("wrong currency -> order NOT paid", st3 === "PENDING_PAYMENT", st3);

  // 5. delivery estimate + VAT stored
  const d = await fetch(B + "/delivery/estimate?postcode=BT1%201AA&subtotal=10").then((x) => x.json()); check("delivery estimate NI", d.zone === "Northern Ireland" && d.currency === "GBP", JSON.stringify(d));
} catch (e) { console.error("TEST ERROR", e); results.push(false); }
finally { await db.end(); srv.kill(); stripe.close(); console.log(results.every(Boolean) ? "ALL PASSED" : "SOME FAILED", `${results.filter(Boolean).length}/${results.length}`); process.exit(0); }
