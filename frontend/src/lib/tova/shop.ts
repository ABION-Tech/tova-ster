import type { Features, Product } from "./types";

export const NEEDS = [
  { id: "immunity", name: "Immunity", note: "Vitamin D3, vitamin C, zinc", color: "var(--f-d3)", ink: "#1A1406", hero: "vitamin-d3-4000iu" },
  { id: "energy", name: "Energy & tiredness", note: "Iron with vitamin C", color: "var(--f-iron)", ink: "#fff", hero: "iron-vitamin-c" },
  { id: "beauty", name: "Skin, hair & nails", note: "Collagen, biotin, selenium", color: "var(--f-collagen)", ink: "#1A1406", hero: "collagen-complex" },
  { id: "kids", name: "Kids", note: "Chewable berry gummies", color: "var(--f-kids)", ink: "#1A1406", hero: "kids-multivitamin-mineral" },
  { id: "training", name: "Training", note: "Creatine monohydrate", color: "var(--f-creatine)", ink: "#fff", hero: "creatine-monohydrate" },
] as const;

export const WHO = [{ id: "women", name: "Women" }, { id: "men", name: "Men" }, { id: "kids", name: "Kids" }, { id: "training", name: "Training" }] as const;
export const FORMATS = ["Tablets", "Capsules", "Gummies", "Powder"] as const;

export const round2 = (n: number) => Math.round(n * 100) / 100;
/** "£40" for whole pounds (thresholds, headlines), "£12.99" otherwise. */
export const gbpShort = (n: number) => (Number.isInteger(round2(n)) ? `£${round2(n)}` : gbp(n));
export const gbp = (n: number) => "£" + round2(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const subPrice = (p: Product, f: Features) => round2(p.price * (1 - f.subscribe.discount / 100));
export const freqLabel = (m: number) => (m === 1 ? "month" : `${m} months`);
export const hourLabel = (h: number) => (h > 12 ? `${h - 12}pm` : h === 12 ? "12pm" : `${h}am`);

export function needOf(p: Product) {
  return NEEDS.find((n) => n.id === p.needs[0]) ?? { id: "", name: "Shop", note: "", color: "var(--surface)", ink: "var(--ink)", hero: "" };
}

export function stockState(p: Product): "out" | "low" | "ok" {
  if (!p.inStock) return "out";
  return p.onlyLeft ? "low" : "ok";
}

export function multibuyTitle(mode: Features["multibuy"]["mode"]) {
  return mode === "3for2" ? "3 for 2 on everything" : mode === "2save10" ? "Buy any 2, save 10%" : "Buy any 3, save 20%";
}

export function cutoffText(cutoffHour: number, now = new Date()): { lead: string; bold: string; tail: string } {
  // UK time, whatever the shopper's device clock zone.
  const uk = new Date(now.toLocaleString("en-US", { timeZone: "Europe/London" }));
  const cut = new Date(uk); cut.setHours(cutoffHour, 0, 0, 0);
  const wd = uk.getDay();
  if (wd === 0 || wd === 6 || uk >= cut) return { lead: "Order now and we'll send it ", bold: "on the next working day", tail: "." };
  const m = Math.floor((cut.getTime() - uk.getTime()) / 60000);
  return { lead: "Order in the next ", bold: `${Math.floor(m / 60)}h ${m % 60}m`, tail: " and we'll send it today." };
}

/** Shop URL from filters (keeps links and the filter panel in one format). */
export function shopHref(f: Record<string, string | undefined> = {}) {
  const qs = new URLSearchParams(Object.entries(f).filter((e): e is [string, string] => !!e[1])).toString();
  return `/shop${qs ? `?${qs}` : ""}`;
}
