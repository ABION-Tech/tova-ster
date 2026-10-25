import { test } from "node:test";
import assert from "node:assert/strict";
import { priceBasket, type PricingFeatures, type PricingInput, type PricingLine, type PricingBundle } from "./engine.js";

// Expected figures below were worked out by hand, not copied from the engine.

const F: PricingFeatures = {
  freeDelivery: { on: true, threshold: 40 },
  subscribe: { on: true, discount: 15 },
  multibuy: { on: true, mode: "3for2" },
  bundles: { on: true },
  quiz: { on: true, discount: 10 },
  codes: { on: true },
  rewards: { on: true, earn: 5, pointValue: 1, minRedeem: 500 },
};
const RATES = { mainland: 3.99, highlands: 7.99, ni: 5.99 };
const PRICES: Record<string, number> = { d3: 12.99, iron: 9.99, mag: 11.99, b6: 13.99, collagen: 17.99, kids: 14.99, creatine: 24.99 };

let n = 0;
function line(pid: string, qty = 1, extra: Partial<PricingLine> = {}): PricingLine {
  return { id: `l${++n}`, productId: pid, name: pid, unitPrice: PRICES[pid], quantity: qty, vatRate: 20, subscriptionMonths: null, bundleId: null, ...extra };
}
function input(lines: PricingLine[], over: Partial<PricingInput> = {}): PricingInput {
  return { lines, bundles: new Map(), features: F, deliveryRates: RATES, zone: "mainland", code: null, points: { signedIn: false, balance: 0, redeem: false }, ...over };
}
const sumNet = (r: ReturnType<typeof priceBasket>) => Math.round(r.lines.reduce((s, l) => s + l.netTotal, 0) * 100) / 100;

test("subscribe line + one-time line, under free delivery", () => {
  const r = priceBasket(input([line("d3", 1, { subscriptionMonths: 1 }), line("iron")]));
  // 12.99 x 0.85 = 11.0415 -> 11.04 ; 11.04 + 9.99 = 21.03 ; + 3.99 = 25.02
  assert.equal(r.full, 22.98);
  assert.equal(r.subscribeSaving, 1.95);
  assert.equal(r.multibuySaving, 0);
  assert.equal(r.merchandise, 21.03);
  assert.equal(r.delivery, 3.99);
  assert.equal(r.total, 25.02);
  assert.equal(r.vat, 4.17); // 21.03/6 = 3.505 ; 3.99/6 = 0.665 ; 4.17
  assert.equal(r.pointsEarned, 105); // floor(21.03) x 5
  assert.equal(r.amountToFreeDelivery, 18.97);
  assert.ok(r.hasSubscription);
  assert.equal(sumNet(r), r.merchandise);
});

test("3 for 2 frees the cheapest, then the code is taken off the rest", () => {
  const r = priceBasket(input([line("d3"), line("iron"), line("collagen")], { code: { code: "WELCOME10", pct: 10 } }));
  // 12.99 + 9.99 + 17.99 = 40.97 ; cheapest 9.99 free -> 30.98 ; 10% = 3.098 -> 3.10 ; 27.88 ; + 3.99
  assert.equal(r.full, 40.97);
  assert.equal(r.multibuySaving, 9.99);
  assert.equal(r.multibuyLabel, "3 for 2");
  assert.equal(r.codeSaving, 3.1);
  assert.equal(r.merchandise, 27.88);
  assert.equal(r.total, 31.87);
  assert.equal(r.saved, 13.09);
  assert.equal(sumNet(r), r.merchandise);
});

test("3 for 2 on six units frees the 3rd and 6th most expensive", () => {
  const r = priceBasket(input([line("creatine", 2), line("collagen", 2), line("iron", 2)]));
  // sorted 24.99 24.99 17.99 | 17.99 9.99 9.99 -> free 17.99 + 9.99 = 27.98
  assert.equal(r.multibuySaving, 27.98);
});

test("subscription and bundle lines never count towards multi-buy", () => {
  const b: PricingBundle = { id: "b1", name: "Winter defence", pct: 15, active: true, kind: "standard" };
  const r = priceBasket(input([
    line("d3", 1, { bundleId: "b1" }), line("iron", 1, { bundleId: "b1" }), line("mag", 1, { subscriptionMonths: 2 }),
  ], { bundles: new Map([["b1", b]]) }));
  assert.equal(r.multibuySaving, 0);
  // bundle: 11.04 + 8.49 (9.99 x 0.85 = 8.4915) = 19.53 ; sub: 11.99 x 0.85 = 10.1915 -> 10.19
  assert.equal(r.bundleSaving, 3.45);
  assert.equal(r.subscribeSaving, 1.8);
  assert.equal(r.merchandise, 29.72);
  assert.equal(r.total, 33.71);
});

test("points redeem in 100s, capped by balance and by basket", () => {
  const b: PricingBundle = { id: "b1", name: "Winter defence", pct: 15, active: true, kind: "standard" };
  const r = priceBasket(input([line("d3", 1, { bundleId: "b1" }), line("iron", 1, { bundleId: "b1" })], {
    bundles: new Map([["b1", b]]), points: { signedIn: true, balance: 750, redeem: true },
  }));
  // 19.53 ; balance 750 -> 700 points = £7.00 ; 12.53 + 3.99
  assert.equal(r.pointsUsed, 700);
  assert.equal(r.pointsSaving, 7);
  assert.equal(r.merchandise, 12.53);
  assert.equal(r.total, 16.52);
  assert.equal(sumNet(r), r.merchandise);

  const small = priceBasket(input([line("iron")], { points: { signedIn: true, balance: 5000, redeem: true } }));
  // 9.99 -> at most 999 points -> 900 in steps of 100 = £9.00
  assert.equal(small.pointsUsed, 900);
  assert.equal(small.merchandise, 0.99);

  const below = priceBasket(input([line("iron")], { points: { signedIn: true, balance: 499, redeem: true } }));
  assert.equal(below.pointsUsed, 0);
  const guest = priceBasket(input([line("iron")], { points: { signedIn: false, balance: 5000, redeem: true } }));
  assert.equal(guest.pointsUsed, 0);
});

test("free delivery over the threshold in every zone; zone rates otherwise", () => {
  const r = priceBasket(input([line("creatine", 2)], { zone: "highlands" }));
  assert.equal(r.merchandise, 49.98);
  assert.equal(r.delivery, 0);
  assert.equal(r.total, 49.98);
  assert.equal(priceBasket(input([line("iron")], { zone: "ni" })).delivery, 5.99);
  assert.equal(priceBasket(input([line("iron")], { zone: "highlands" })).delivery, 7.99);
  const est = priceBasket(input([line("iron")], { zone: null }));
  assert.equal(est.delivery, 3.99);
  assert.ok(est.deliveryIsEstimate);
  assert.equal(priceBasket(input([])).total, 0);
});

test("switches in admin turn rules off", () => {
  const off: PricingFeatures = { ...F, multibuy: { on: false, mode: "3for2" }, subscribe: { on: false, discount: 15 }, codes: { on: false }, freeDelivery: { on: false, threshold: 40 } };
  const r = priceBasket(input([line("creatine", 2), line("d3", 1, { subscriptionMonths: 1 })], { features: off, code: { code: "X", pct: 10 } }));
  // 49.98 + 12.99 = 62.97, nothing off, delivery charged
  assert.equal(r.saved, 0);
  assert.equal(r.total, 66.96);
});

test("quiz sets use the quiz discount from settings; inactive bundles price normally", () => {
  const q: PricingBundle = { id: "q", name: "Your quiz set", pct: 0, active: true, kind: "quiz" };
  const r = priceBasket(input([line("d3", 1, { bundleId: "q" }), line("b6", 1, { bundleId: "q" })], { bundles: new Map([["q", q]]) }));
  // 12.99 x 0.9 = 11.691 -> 11.69 ; 13.99 x 0.9 = 12.591 -> 12.59 ; 24.28
  assert.equal(r.merchandise, 24.28);
  const dead: PricingBundle = { id: "d", name: "Old", pct: 15, active: false, kind: "standard" };
  const r2 = priceBasket(input([line("d3", 1, { bundleId: "d" }), line("iron", 1, { bundleId: "d" })], { bundles: new Map([["d", dead]]) }));
  assert.equal(r2.bundleSaving, 0);
  assert.equal(r2.merchandise, 22.98);
});

test("2 save 10 and 3 save 20 modes", () => {
  const two = priceBasket(input([line("d3"), line("iron")], { features: { ...F, multibuy: { on: true, mode: "2save10" } } }));
  assert.equal(two.multibuySaving, 2.3); // 22.98 x 10% = 2.298
  const three = priceBasket(input([line("d3"), line("iron")], { features: { ...F, multibuy: { on: true, mode: "3save20" } } }));
  assert.equal(three.multibuySaving, 0);
});
