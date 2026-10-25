/**
 * UK delivery rules, keyed by postcode. All amounts are GBP, VAT-inclusive.
 * Fees and the free-delivery threshold are placeholders until the client
 * confirms carrier rates — set them with environment variables (no code change):
 *   DELIVERY_FEE_MAINLAND, DELIVERY_FEE_HIGHLANDS, DELIVERY_FEE_NI, FREE_DELIVERY_THRESHOLD
 */

export class UnsupportedDestinationError extends Error {}

export interface DeliveryQuote {
  fee: number;
  zone: "Mainland" | "Highlands & Islands" | "Northern Ireland";
  freeDeliveryThreshold: number;
  qualifiesForFree: boolean;
}

function envNumber(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== undefined && process.env[name] !== "" ? v : fallback;
}

const UK_POSTCODE = /^([A-Z]{1,2})([0-9][A-Z0-9]?)([0-9][A-Z]{2})$/;

// Crown Dependencies are outside the UK for VAT and customs: not served at launch.
const NOT_SERVED_AREAS = new Set(["IM", "GY", "JE"]);
const HIGHLAND_AREAS = new Set(["IV", "HS", "KW", "ZE"]);
// Area -> inclusive district ranges that carriers surcharge as Highlands & Islands.
const HIGHLAND_RANGES: Record<string, [number, number][]> = {
  PA: [[20, 49], [60, 78]],
  PH: [[17, 26], [30, 44], [49, 50]],
  KA: [[27, 28]],
  TR: [[21, 25]],
};

export function normalisePostcode(input: string): string | null {
  const compact = input.toUpperCase().replace(/\s+/g, "");
  return UK_POSTCODE.test(compact) ? compact : null;
}

export function formatPostcode(input: string): string {
  const pc = normalisePostcode(input);
  return pc ? `${pc.slice(0, -3)} ${pc.slice(-3)}` : input.trim().toUpperCase();
}

export type ZoneKey = "mainland" | "highlands" | "ni";
const ZONE_NAME: Record<ZoneKey, DeliveryQuote["zone"]> = { mainland: "Mainland", highlands: "Highlands & Islands", ni: "Northern Ireland" };

/** Which delivery zone a postcode falls in. Throws for invalid or unserved postcodes. */
export function deliveryZone(postcode: string): ZoneKey {
  const pc = normalisePostcode(postcode);
  if (!pc) throw new UnsupportedDestinationError("Please enter a valid UK postcode.");
  const [, area, district] = pc.match(UK_POSTCODE)!;
  if (NOT_SERVED_AREAS.has(area)) {
    throw new UnsupportedDestinationError("We don't deliver to the Channel Islands or Isle of Man yet.");
  }
  if (area === "BT") return "ni";
  const districtNum = parseInt(district, 10);
  const inHighlandRange = (HIGHLAND_RANGES[area] ?? []).some(([lo, hi]) => districtNum >= lo && districtNum <= hi);
  return HIGHLAND_AREAS.has(area) || inHighlandRange ? "highlands" : "mainland";
}

export interface DeliveryRates { mainland: number; highlands: number; ni: number; threshold: number | null }

/** Env vars are the fallback; the admin's delivery settings override them when passed in. */
export function envDeliveryRates(): DeliveryRates {
  return {
    mainland: envNumber("DELIVERY_FEE_MAINLAND", 3.99),
    highlands: envNumber("DELIVERY_FEE_HIGHLANDS", 7.99),
    ni: envNumber("DELIVERY_FEE_NI", 5.99),
    threshold: envNumber("FREE_DELIVERY_THRESHOLD", 40),
  };
}

/** Free delivery over the threshold applies to every zone, matching "Free UK delivery over £40". */
export function computeDelivery(postcode: string, basketTotal: number, rates: DeliveryRates = envDeliveryRates()): DeliveryQuote {
  const zone = deliveryZone(postcode);
  const threshold = rates.threshold ?? Infinity;
  const qualifiesForFree = basketTotal >= threshold;
  return {
    fee: qualifiesForFree ? 0 : rates[zone],
    zone: ZONE_NAME[zone],
    freeDeliveryThreshold: rates.threshold ?? 0,
    qualifiesForFree,
  };
}
