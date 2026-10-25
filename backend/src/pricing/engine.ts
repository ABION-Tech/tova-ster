/**
 * The one place prices are worked out. Pure: no database, no clock, so the
 * basket, checkout, order and receipt all agree to the penny and the rules
 * can be tested with exact sums. Mirrors the clickable demo's totals():
 *
 *   full price
 *   - Subscribe & Save (per line)        - bundle / quiz-set saving (per line)
 *   - multi-buy (one-time single items only)
 *   - discount code (% of what is left)  - reward points (100-point steps)
 *   = merchandise total
 *   + delivery (free over the threshold, else the zone rate)
 *
 * All money is GBP and VAT-inclusive.
 */

export type MultibuyMode = "3for2" | "2save10" | "3save20";
export type ZoneKey = "mainland" | "highlands" | "ni";

export interface PricingFeatures {
  freeDelivery: { on: boolean; threshold: number };
  subscribe: { on: boolean; discount: number };
  multibuy: { on: boolean; mode: MultibuyMode };
  bundles: { on: boolean };
  quiz: { on: boolean; discount: number };
  codes: { on: boolean };
  rewards: { on: boolean; earn: number; pointValue: number; minRedeem: number };
}

export interface PricingLine {
  id: string;
  productId: string;
  name: string;
  unitPrice: number;            // live full price of one unit
  quantity: number;
  vatRate: number;              // e.g. 20
  subscriptionMonths: number | null;
  bundleId: string | null;
}

export interface PricingBundle { id: string; name: string; pct: number; active: boolean; kind: "standard" | "quiz" }

export interface PricingInput {
  lines: PricingLine[];
  bundles: Map<string, PricingBundle>;
  features: PricingFeatures;
  deliveryRates: Record<ZoneKey, number>;
  zone: ZoneKey | null;          // null = no postcode yet, quote mainland as an estimate
  code: { code: string; pct: number } | null;
  points: { signedIn: boolean; balance: number; redeem: boolean };
}

export interface PricedLine extends PricingLine {
  fullUnit: number;
  chargedUnit: number;          // after subscribe / bundle saving
  lineTotal: number;            // chargedUnit x quantity
  bundleName: string | null;
  isSubscription: boolean;
  basketShare: number;          // multi-buy + code + points allocated to this line (for VAT)
  netTotal: number;             // what this line finally costs
}

export interface Discount { type: "subscribe" | "bundle" | "multibuy" | "code" | "points"; label: string; amount: number }

export interface PricingResult {
  lines: PricedLine[];
  itemCount: number;
  full: number;
  subscribeSaving: number;
  bundleSaving: number;
  multibuySaving: number;
  multibuyLabel: string;
  codeSaving: number;
  code: string | null;
  pointsUsed: number;
  pointsSaving: number;
  merchandise: number;
  delivery: number;
  deliveryZone: ZoneKey;
  deliveryIsEstimate: boolean;
  freeDeliveryThreshold: number | null;
  amountToFreeDelivery: number;
  total: number;
  vat: number;
  pointsEarned: number;
  saved: number;
  discounts: Discount[];
  hasSubscription: boolean;
}

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const MULTIBUY_LABEL: Record<MultibuyMode, string> = { "3for2": "3 for 2", "2save10": "Buy 2, save 10%", "3save20": "Buy 3, save 20%" };

/** Spread `amount` over `weights` in pennies so the parts always add back up exactly. */
function allocate(amount: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  const pennies = Math.round(amount * 100);
  if (total <= 0 || pennies === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (pennies * w) / total);
  const out = raw.map(Math.floor);
  let left = pennies - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k][1]]++;
  return out.map((p) => p / 100);
}

export function bundlePct(b: PricingBundle | undefined, f: PricingFeatures): number {
  if (!b || !b.active) return 0;
  if (b.kind === "quiz") return f.quiz.on ? f.quiz.discount : 0;
  return f.bundles.on ? b.pct : 0;
}

export function priceBasket(input: PricingInput): PricingResult {
  const f = input.features;

  // 1. Line-level prices: subscription or bundle saving.
  const lines: PricedLine[] = input.lines.map((l) => {
    const bundle = l.bundleId ? input.bundles.get(l.bundleId) : undefined;
    const bPct = bundlePct(bundle, f);
    const isSubscription = !l.bundleId && l.subscriptionMonths != null && f.subscribe.on;
    let chargedUnit = l.unitPrice;
    if (bPct > 0) chargedUnit = round2(l.unitPrice * (1 - bPct / 100));
    else if (isSubscription) chargedUnit = round2(l.unitPrice * (1 - f.subscribe.discount / 100));
    return {
      ...l,
      fullUnit: l.unitPrice,
      chargedUnit,
      lineTotal: round2(chargedUnit * l.quantity),
      bundleName: bundle && bPct > 0 ? bundle.name : null,
      isSubscription,
      basketShare: 0,
      netTotal: 0,
    };
  });

  const full = round2(lines.reduce((s, l) => s + l.fullUnit * l.quantity, 0));
  const afterLine = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const subscribeSaving = round2(lines.filter((l) => l.isSubscription).reduce((s, l) => s + (l.fullUnit - l.chargedUnit) * l.quantity, 0));
  const bundleSaving = round2(lines.filter((l) => l.bundleName).reduce((s, l) => s + (l.fullUnit - l.chargedUnit) * l.quantity, 0));

  // 2. Multi-buy: only one-time, single (non-bundle) units count.
  const eligible = lines.map((l) => !l.bundleName && !l.isSubscription);
  let multibuySaving = 0;
  let multibuyLabel = "";
  if (f.multibuy.on) {
    const units: number[] = [];
    lines.forEach((l, i) => { if (eligible[i]) for (let q = 0; q < l.quantity; q++) units.push(l.fullUnit); });
    const sum = units.reduce((a, b) => a + b, 0);
    if (f.multibuy.mode === "3for2") {
      units.sort((a, b) => b - a);
      for (let i = 2; i < units.length; i += 3) multibuySaving += units[i]; // cheapest of every three is free
    } else if (f.multibuy.mode === "2save10" && units.length >= 2) multibuySaving = sum * 0.1;
    else if (f.multibuy.mode === "3save20" && units.length >= 3) multibuySaving = sum * 0.2;
    multibuySaving = round2(multibuySaving);
    if (multibuySaving > 0) multibuyLabel = MULTIBUY_LABEL[f.multibuy.mode];
  }
  let merchandise = round2(afterLine - multibuySaving);

  // 3. Discount code, as a percentage of what is left.
  let codeSaving = 0;
  const code = f.codes.on && input.code ? input.code : null;
  if (code) codeSaving = round2((merchandise * code.pct) / 100);
  merchandise = round2(merchandise - codeSaving);

  // 4. Reward points, redeemed in steps of 100, never more than the basket.
  let pointsUsed = 0;
  let pointsSaving = 0;
  const r = f.rewards;
  if (r.on && input.points.signedIn && input.points.redeem && input.points.balance >= r.minRedeem && r.pointValue > 0) {
    const maxPts = Math.floor((merchandise * 100) / r.pointValue);
    pointsUsed = Math.min(Math.floor(input.points.balance / 100) * 100, Math.floor(maxPts / 100) * 100);
    pointsSaving = round2((pointsUsed * r.pointValue) / 100);
  }
  merchandise = round2(merchandise - pointsSaving);

  // 5. Delivery.
  const zone: ZoneKey = input.zone ?? "mainland";
  const threshold = f.freeDelivery.on ? f.freeDelivery.threshold : null;
  const free = threshold !== null && merchandise >= threshold;
  const delivery = lines.length === 0 || free ? 0 : round2(input.deliveryRates[zone]);
  const total = round2(merchandise + delivery);

  // 6. Spread basket-level savings over the lines, so each line knows its true
  //    cost (VAT, refunds of one item). Multi-buy only lands on eligible lines.
  const multiShare = allocate(multibuySaving, lines.map((l, i) => (eligible[i] ? l.lineTotal : 0)));
  const afterMulti = lines.map((l, i) => l.lineTotal - multiShare[i]);
  const restShare = allocate(round2(codeSaving + pointsSaving), afterMulti);
  lines.forEach((l, i) => {
    l.basketShare = round2(multiShare[i] + restShare[i]);
    l.netTotal = round2(l.lineTotal - l.basketShare);
  });

  // VAT is included in every price: VAT = gross x rate / (100 + rate). Delivery is standard-rated.
  const vat = round2(lines.reduce((s, l) => s + (l.netTotal * l.vatRate) / (100 + l.vatRate), 0) + (delivery * 20) / 120);

  const discounts: Discount[] = [];
  if (subscribeSaving > 0) discounts.push({ type: "subscribe", label: `Subscribe & Save ${f.subscribe.discount}%`, amount: subscribeSaving });
  if (bundleSaving > 0) discounts.push({ type: "bundle", label: "Bundle savings", amount: bundleSaving });
  if (multibuySaving > 0) discounts.push({ type: "multibuy", label: multibuyLabel, amount: multibuySaving });
  if (codeSaving > 0 && code) discounts.push({ type: "code", label: `Code ${code.code}`, amount: codeSaving });
  if (pointsSaving > 0) discounts.push({ type: "points", label: `${pointsUsed} points`, amount: pointsSaving });

  return {
    lines,
    itemCount: lines.reduce((s, l) => s + l.quantity, 0),
    full,
    subscribeSaving,
    bundleSaving,
    multibuySaving,
    multibuyLabel,
    codeSaving,
    code: code && codeSaving > 0 ? code.code : code?.code ?? null,
    pointsUsed,
    pointsSaving,
    merchandise,
    delivery,
    deliveryZone: zone,
    deliveryIsEstimate: input.zone === null,
    freeDeliveryThreshold: threshold,
    amountToFreeDelivery: threshold !== null && !free ? round2(threshold - merchandise) : 0,
    total,
    vat,
    pointsEarned: r.on ? Math.floor(merchandise) * r.earn : 0,
    saved: round2(subscribeSaving + bundleSaving + multibuySaving + codeSaving + pointsSaving),
    discounts,
    hasSubscription: lines.some((l) => l.isSubscription),
  };
}
