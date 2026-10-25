import { SETTINGS_DEFAULTS, type SettingsKey, type QuizQuestion } from "./defaults.js";

/**
 * Checks an admin save against the shape of the defaults: every field that
 * exists in the defaults must keep its type (number stays number, on/off stays
 * boolean). Unknown fields are dropped. Returns the cleaned value or an error.
 */
export function validateSetting(key: SettingsKey, value: unknown): { value: unknown } | { error: string } {
  if (key === "quiz") return validateQuiz(value);
  try {
    return { value: check(SETTINGS_DEFAULTS[key], value, key) };
  } catch (e) {
    if (e instanceof Invalid) return { error: e.message };
    throw e;
  }
}

class Invalid extends Error {}
const bad = (msg: string): never => { throw new Invalid(msg); };

function check(def: unknown, val: unknown, path: string): unknown {
  if (val === undefined) return def;
  if (def === null) return val; // optional media slots etc.
  if (Array.isArray(def)) {
    if (!Array.isArray(val)) return bad(`${path} must be a list.`);
    if (val.length > 50) return bad(`${path} has too many entries.`);
    if (path === "site.hero.slides") return checkSlides(val);
    if (path === "site.insta.posts") return val.map((m, i) => (m == null ? null : checkMedia(m, `${path}.${i + 1}`)));
    return val;
  }
  if (typeof def === "object") {
    if (typeof val !== "object" || val === null || Array.isArray(val)) return bad(`${path} must be a group of settings.`);
    const out: Record<string, unknown> = {};
    const d = def as Record<string, unknown>;
    // Free-form maps in the defaults (e.g. site.needs) accept any keys.
    const keys = Object.keys(d).length === 0 ? Object.keys(val as object) : Object.keys(d);
    for (const k of keys) {
      out[k] = check(d[k], (val as Record<string, unknown>)[k], `${path}.${k}`);
    }
    return out;
  }
  if (typeof def === "number") {
    const n = typeof val === "string" && val.trim() !== "" ? Number(val) : val;
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return bad(`${path} must be a number of 0 or more.`);
    return n;
  }
  if (typeof def === "boolean") {
    if (typeof val !== "boolean") return bad(`${path} must be on or off.`);
    return val;
  }
  if (typeof def === "string") {
    if (typeof val !== "string") return bad(`${path} must be text.`);
    if (path.endsWith("multibuy.mode") && !["3for2", "2save10", "3save20"].includes(val)) return bad("Choose a multi-buy offer from the list.");
    if ((path.endsWith(".src") || path.endsWith(".url")) && val && !/^(https:\/\/|\/(?!\/))/.test(val)) return bad(`${path} must be an https link or a site path.`);
    return val.slice(0, 5000);
  }
  return val;
}

function checkMedia(m: unknown, path: string) {
  if (typeof m !== "object" || m === null) return bad(`${path} must be a picture or video.`);
  const { src, kind } = m as { src?: unknown; kind?: unknown };
  if (typeof src !== "string" || !/^(https:\/\/|\/(?!\/))/.test(src)) return bad(`${path} needs an https link or a site path.`);
  return { src: src.slice(0, 1000), kind: kind === "video" ? "video" : "image" };
}

/** Hero slides: up to 8, each with text the shopper can read and a working link. */
function checkSlides(list: unknown[]) {
  if (list.length > 8) return bad("The hero can have up to 8 slides.");
  const txt = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const out = list.map((raw, i) => {
    const s = (raw ?? {}) as Record<string, unknown>;
    const n = i + 1;
    const title = txt(s.title, 90);
    if (!title) return bad(`Slide ${n} needs a headline.`);
    const href = txt(s.ctaHref, 300) || "/shop";
    if (!/^(https:\/\/|\/(?!\/))/.test(href)) return bad(`Slide ${n}'s button link must start with / or https://.`);
    return {
      id: txt(s.id, 40) || `s${n}`,
      on: s.on !== false,
      productSlug: txt(s.productSlug, 80),
      kicker: txt(s.kicker, 80),
      title,
      text: txt(s.text, 300),
      ctaLabel: txt(s.ctaLabel, 40) || "Shop now",
      ctaHref: href,
      media: s.media == null ? null : checkMedia(s.media, `Slide ${n} picture`),
      tone: s.tone === "dark" ? "dark" : "light",
      bg: typeof s.bg === "string" && /^#[0-9a-fA-F]{6}$/.test(s.bg) ? s.bg : (s.tone === "dark" ? "#0E0E0E" : "#F3F2EF"),
    };
  });
  if (!out.some((s) => s.on)) return bad("Keep at least one hero slide switched on.");
  return out;
}

function validateQuiz(value: unknown): { value: QuizQuestion[] } | { error: string } {
  if (!Array.isArray(value) || value.length === 0) return { error: "The quiz needs at least one question." };
  if (value.length > 20) return { error: "The quiz can have up to 20 questions." };
  const ids = new Set<string>();
  const clean: QuizQuestion[] = [];
  for (const [i, q] of value.entries()) {
    const n = i + 1;
    if (!q || typeof q.id !== "string" || !q.id.trim()) return { error: `Question ${n} needs an id.` };
    if (ids.has(q.id)) return { error: `Two questions share the id "${q.id}".` };
    ids.add(q.id);
    if (typeof q.q !== "string" || !q.q.trim()) return { error: `Question ${n} needs some text.` };
    if (!Array.isArray(q.opts) || q.opts.length < 2) return { error: `Question ${n} needs at least two answers.` };
    const opts = [];
    for (const o of q.opts) {
      if (!o || typeof o.id !== "string" || typeof o.label !== "string" || !o.label.trim()) return { error: `An answer in question ${n} has no label.` };
      opts.push({ id: o.id, label: o.label.slice(0, 200), productSlug: typeof o.productSlug === "string" ? o.productSlug : "", why: typeof o.why === "string" ? o.why.slice(0, 500) : "", gp: !!o.gp });
    }
    let showIf: QuizQuestion["showIf"] = null;
    if (q.showIf && typeof q.showIf === "object") {
      if (!ids.has(q.showIf.q) || q.showIf.q === q.id) return { error: `Question ${n} can only depend on an earlier question.` };
      showIf = { q: String(q.showIf.q), op: q.showIf.op === "is" ? "is" : "not", o: String(q.showIf.o) };
    }
    clean.push({ id: q.id, q: q.q.slice(0, 300), multi: !!q.multi, on: q.on !== false, showIf, opts });
  }
  return { value: clean };
}
