import { pool } from "../db/pool.js";
import { SETTINGS_DEFAULTS, SETTINGS_KEYS, type SettingsKey } from "./defaults.js";

type Settings = typeof SETTINGS_DEFAULTS;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Stored values win; objects merge key by key; arrays and scalars replace. */
export function deepMerge<T>(base: T, over: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(over)) return (over === undefined ? base : (over as T));
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over)) out[k] = k in out ? deepMerge(out[k], v) : v;
  return out as T;
}

let cache: { at: number; value: Settings } | null = null;
const CACHE_MS = 5_000;

export async function getAllSettings(): Promise<Settings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const rows = await pool.query<{ key: string; value: unknown }>(`SELECT key, value FROM site_settings`);
  const stored = new Map(rows.rows.map((r) => [r.key, r.value]));
  const value = {} as Record<string, unknown>;
  for (const key of SETTINGS_KEYS) {
    const def = SETTINGS_DEFAULTS[key];
    const s = stored.get(key);
    // The quiz is an ordered list edited as a whole: stored replaces default.
    value[key] = Array.isArray(def) ? (Array.isArray(s) ? s : def) : deepMerge(def, s);
  }
  cache = { at: Date.now(), value: value as Settings };
  return cache.value;
}

export async function getSetting<K extends SettingsKey>(key: K): Promise<Settings[K]> {
  return (await getAllSettings())[key];
}

export async function saveSetting(key: SettingsKey, value: unknown, adminId: string | null): Promise<void> {
  await pool.query(
    `INSERT INTO site_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [key, JSON.stringify(value), adminId],
  );
  cache = null;
}

export function isSettingsKey(k: string): k is SettingsKey {
  return (SETTINGS_KEYS as string[]).includes(k);
}
