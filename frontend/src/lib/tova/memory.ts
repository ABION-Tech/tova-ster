/**
 * What the shop remembers in this browser. Everything is wrapped in try/catch:
 * private windows, blocked storage and old Safari must never break the shop,
 * they just forget between visits.
 *
 *  - catalogue + storefront settings: cached, shown instantly next visit,
 *    refreshed in the background (stale-while-revalidate)
 *  - recently viewed, quiz answers/result, cookie choice, checkout draft
 *  - signed-in shoppers also get recently viewed and quiz synced to their
 *    account (see ShopProvider), so it follows them across devices
 */
const NS = "tova:";
const VERSION = 1;

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(NS + key);
    if (!raw) return null;
    const v = JSON.parse(raw) as { v: number; d: T };
    return v.v === VERSION ? v.d : null;
  } catch { return null; }
}
function write(key: string, d: unknown) {
  try { localStorage.setItem(NS + key, JSON.stringify({ v: VERSION, d })); } catch { /* storage full or blocked */ }
}
function drop(key: string) {
  try { localStorage.removeItem(NS + key); } catch { /* ignore */ }
}

/** Where this visitor came from and on what device. */
export interface VisitSource { referrer?: string; utm_source?: string; utm_medium?: string; utm_campaign?: string; utm_content?: string; landing?: string; device?: string; firstSeen?: string }

export function deviceType(): "phone" | "tablet" | "computer" {
  try {
    const coarse = matchMedia("(pointer: coarse)").matches, w = Math.min(screen.width, screen.height);
    return coarse && w < 600 ? "phone" : coarse && w < 1100 ? "tablet" : "computer";
  } catch { return "computer"; }
}

/** Read once when the page first loads and held in memory only; saved only if the visitor accepts analytics cookies. */
const LANDING: VisitSource | null = typeof window === "undefined" ? null : (() => {
  try {
    const u = new URL(location.href), out: VisitSource = { landing: u.pathname, device: deviceType(), firstSeen: new Date().toISOString() };
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content"] as const) { const v = u.searchParams.get(k); if (v) out[k] = v.slice(0, 120); }
    if (document.referrer) {
      const r = new URL(document.referrer);
      if (r.host !== location.host) out.referrer = r.hostname.replace(/^(www|m|l|lm)\./, "");
    }
    return out;
  } catch { return null; }
})();

export const memory = {
  get: read,
  set: write,
  remove: drop,

  recentlyViewed(): string[] { return read<string[]>("recent") ?? []; },
  addRecentlyViewed(slug: string): string[] {
    const list = [slug, ...this.recentlyViewed().filter((s) => s !== slug)].slice(0, 12);
    write("recent", list);
    return list;
  },
  setRecentlyViewed(list: string[]) { write("recent", list.slice(0, 12)); },

  consent(): "all" | "essential" | null { return read("consent"); },

  /** The first source this browser came from (only stored after "Accept all"). */
  source(): VisitSource | null { return read<VisitSource>("source"); },
  keepSource(): VisitSource | null {
    const have = read<VisitSource>("source");
    if (have) return have;
    if (LANDING) write("source", LANDING);
    return LANDING;
  },
  /** This page load's own details (landing page, campaign, device), for the visit event. */
  landing(): VisitSource | null { return LANDING; },
  setConsent(c: "all" | "essential") { write("consent", c); },

  /** A random id for this visit, used to group analytics events. Never an IP or fingerprint. */
  sessionId(): string {
    try {
      let id = sessionStorage.getItem(NS + "sid");
      if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem(NS + "sid", id); }
      return id;
    } catch { return "nostore"; }
  },
};

export interface QuizMemory { answers: Record<string, string[]>; step: number; productSlugs?: string[]; gp?: boolean; at?: string }
