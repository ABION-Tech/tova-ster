import { pool } from "../db/pool.js";
import { seal, open } from "./secretBox.js";

/**
 * Instagram API with Instagram Login (professional accounts).
 * Docs: developers.facebook.com/documentation/instagram-platform
 *   GET {base}/{ver}/me?fields=user_id,username
 *   GET {base}/{ver}/{ig-user-id}/media?fields=...
 *   GET {base}/refresh_access_token?grant_type=ig_refresh_token   (60-day tokens)
 * Base and version come from env so a Meta API bump is a config change.
 */
const BASE = () => (process.env.INSTAGRAM_API_BASE ?? "https://graph.instagram.com").replace(/\/$/, "");
const VER = () => process.env.INSTAGRAM_API_VERSION ?? "v26.0";
const FIELDS = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{id,media_type,media_url,thumbnail_url}";
const MAX_PAGES = 6; // up to ~300 posts

export class InstagramError extends Error {}

// ── "Connect Instagram" (Business Login for Instagram) ──
// The owner clicks Connect in the admin, logs in to Instagram, approves, and
// comes back here; the code is swapped for a 60-day token that sync() renews.
const OAUTH_BASE = () => (process.env.INSTAGRAM_OAUTH_BASE ?? "https://www.instagram.com").replace(/\/$/, "");
const TOKEN_BASE = () => (process.env.INSTAGRAM_TOKEN_BASE ?? "https://api.instagram.com").replace(/\/$/, "");

export function oauthConfigured(): boolean {
  return !!(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET && process.env.INSTAGRAM_REDIRECT_URI);
}

export function authorizeUrl(state: string): string {
  const q = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID ?? "",
    redirect_uri: process.env.INSTAGRAM_REDIRECT_URI ?? "",
    response_type: "code",
    scope: "instagram_business_basic",
    state,
  });
  return `${OAUTH_BASE()}/oauth/authorize?${q}`;
}

/** Code from Instagram's redirect → short-lived token → long-lived token → connected and synced. */
export async function connectWithCode(rawCode: string): Promise<{ username: string }> {
  const code = rawCode.replace(/#_$/, "");
  const form = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID ?? "",
    client_secret: process.env.INSTAGRAM_APP_SECRET ?? "",
    grant_type: "authorization_code",
    redirect_uri: process.env.INSTAGRAM_REDIRECT_URI ?? "",
    code,
  });
  const res = await fetch(`${TOKEN_BASE()}/oauth/access_token`, { method: "POST", body: form, signal: AbortSignal.timeout(15_000) });
  const body = (await res.json().catch(() => ({}))) as { data?: { access_token: string }[]; access_token?: string; error_message?: string; error?: { message?: string } };
  const short = body.data?.[0]?.access_token ?? body.access_token;
  if (!res.ok || !short) throw new InstagramError(body.error_message ?? body.error?.message ?? "Instagram didn't accept the sign-in. Please try again.");
  const long = await igGet<{ access_token: string; expires_in: number }>(
    `${BASE()}/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(process.env.INSTAGRAM_APP_SECRET ?? "")}&access_token=${encodeURIComponent(short)}`,
  );
  return connect(long.access_token);
}

interface Conn { access_token_enc: string | null; ig_user_id: string | null; username: string | null; token_expires_at: Date | null; last_sync_at: Date | null; last_error: string | null }

async function conn(): Promise<Conn | null> {
  const r = await pool.query<Conn>(`SELECT access_token_enc, ig_user_id, username, token_expires_at, last_sync_at, last_error FROM instagram_connection WHERE id = 1`);
  return r.rows[0] ?? null;
}

async function token(): Promise<string | null> {
  const c = await conn();
  if (c?.access_token_enc) return open(c.access_token_enc);
  return process.env.INSTAGRAM_ACCESS_TOKEN || null; // first run: picked up from env, then kept (and refreshed) in the database
}

async function igGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & T;
  if (!res.ok) throw new InstagramError(body.error?.message ?? `Instagram returned ${res.status}`);
  return body;
}

/** Saves a token pasted by the admin after checking it actually works. */
export async function connect(raw: string): Promise<{ username: string }> {
  const t = raw.trim();
  if (t.length < 20) throw new InstagramError("That doesn't look like an Instagram access token.");
  const me = await igGet<{ user_id?: string; id?: string; username: string }>(`${BASE()}/${VER()}/me?fields=user_id,username&access_token=${encodeURIComponent(t)}`);
  await pool.query(
    `INSERT INTO instagram_connection (id, access_token_enc, ig_user_id, username, token_expires_at, last_error, updated_at)
     VALUES (1, $1, $2, $3, now() + interval '60 days', NULL, now())
     ON CONFLICT (id) DO UPDATE SET access_token_enc = EXCLUDED.access_token_enc, ig_user_id = EXCLUDED.ig_user_id,
       username = EXCLUDED.username, token_expires_at = EXCLUDED.token_expires_at, last_error = NULL, updated_at = now()`,
    [seal(t), me.user_id ?? me.id, me.username],
  );
  await sync();
  return { username: me.username };
}

export async function disconnect(): Promise<void> {
  await pool.query(`DELETE FROM instagram_connection WHERE id = 1`);
  await pool.query(`DELETE FROM instagram_media`);
}

/** Long-lived tokens last 60 days; refresh well before that so the feed never drops. */
async function refreshIfNeeded(t: string, c: Conn | null): Promise<string> {
  const soon = Date.now() + 15 * 24 * 3600 * 1000;
  if (c?.token_expires_at && c.token_expires_at.getTime() > soon) return t;
  try {
    const r = await igGet<{ access_token: string; expires_in: number }>(`${BASE()}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(t)}`);
    await pool.query(
      `INSERT INTO instagram_connection (id, access_token_enc, token_expires_at, updated_at) VALUES (1, $1, now() + make_interval(secs => $2), now())
       ON CONFLICT (id) DO UPDATE SET access_token_enc = EXCLUDED.access_token_enc, token_expires_at = EXCLUDED.token_expires_at, updated_at = now()`,
      [seal(r.access_token), r.expires_in],
    );
    return r.access_token;
  } catch {
    return t; // a token under 24h old can't be refreshed yet; try again next run
  }
}

interface IgMedia {
  id: string; caption?: string; media_type: string; media_url?: string; thumbnail_url?: string; permalink: string; timestamp: string;
  children?: { data: { id: string; media_type: string; media_url?: string; thumbnail_url?: string }[] };
}

/** Pulls the account's posts into the cache. Posts deleted on Instagram disappear here too. */
export async function sync(): Promise<{ count: number }> {
  let t = await token();
  if (!t) return { count: 0 };
  const c = await conn();
  try {
    t = await refreshIfNeeded(t, c);
    let userId = c?.ig_user_id;
    if (!userId) {
      const me = await igGet<{ user_id?: string; id?: string; username: string }>(`${BASE()}/${VER()}/me?fields=user_id,username&access_token=${encodeURIComponent(t)}`);
      userId = me.user_id ?? me.id ?? null;
      await pool.query(
        `INSERT INTO instagram_connection (id, access_token_enc, ig_user_id, username, token_expires_at) VALUES (1, $1, $2, $3, now() + interval '60 days')
         ON CONFLICT (id) DO UPDATE SET ig_user_id = EXCLUDED.ig_user_id, username = EXCLUDED.username`,
        [seal(t), userId, me.username],
      );
    }
    const all: IgMedia[] = [];
    let next: string | undefined = `${BASE()}/${VER()}/${userId}/media?fields=${encodeURIComponent(FIELDS)}&limit=50&access_token=${encodeURIComponent(t)}`;
    for (let page = 0; next && page < MAX_PAGES; page++) {
      const r: { data: IgMedia[]; paging?: { next?: string } } = await igGet(next);
      all.push(...r.data);
      next = r.paging?.next;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const m of all) {
        await client.query(
          `INSERT INTO instagram_media (id, media_type, media_url, thumbnail_url, permalink, caption, posted_at, children, synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
           ON CONFLICT (id) DO UPDATE SET media_type = EXCLUDED.media_type, media_url = EXCLUDED.media_url, thumbnail_url = EXCLUDED.thumbnail_url,
             permalink = EXCLUDED.permalink, caption = EXCLUDED.caption, posted_at = EXCLUDED.posted_at, children = EXCLUDED.children, synced_at = now()`,
          [m.id, m.media_type, m.media_url ?? null, m.thumbnail_url ?? null, m.permalink, m.caption ?? null, m.timestamp,
            JSON.stringify((m.children?.data ?? []).map((ch) => ({ type: ch.media_type, src: ch.media_url ?? null, thumb: ch.thumbnail_url ?? null })))],
        );
      }
      // Only prune when we read the whole account (not when we stopped at MAX_PAGES).
      if (!next) await client.query(`DELETE FROM instagram_media WHERE NOT (id = ANY($1::text[]))`, [all.map((m) => m.id)]);
      await client.query(`UPDATE instagram_connection SET last_sync_at = now(), last_error = NULL WHERE id = 1`);
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
    return { count: all.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await pool.query(`UPDATE instagram_connection SET last_error = $1 WHERE id = 1`, [msg.slice(0, 500)]);
    throw e instanceof InstagramError ? e : new InstagramError(msg);
  }
}

export async function status() {
  const c = await conn();
  const n = await pool.query<{ total: number; hidden: number }>(`SELECT count(*)::int AS total, count(*) FILTER (WHERE hidden)::int AS hidden FROM instagram_media`);
  return {
    connected: !!(c?.access_token_enc || process.env.INSTAGRAM_ACCESS_TOKEN),
    username: c?.username ?? null,
    tokenExpiresAt: c?.token_expires_at ?? null,
    lastSyncAt: c?.last_sync_at ?? null,
    lastError: c?.last_error ?? null,
    posts: n.rows[0].total,
    hidden: n.rows[0].hidden,
  };
}

export async function feed(limit: number) {
  const r = await pool.query(
    `SELECT id, media_type, media_url, thumbnail_url, permalink, caption, posted_at, children FROM instagram_media
     WHERE NOT hidden ORDER BY posted_at DESC LIMIT $1`, [limit],
  );
  return r.rows.map((m) => ({
    id: m.id as string,
    type: (m.media_type === "VIDEO" ? "video" : m.media_type === "CAROUSEL_ALBUM" ? "album" : "image") as "video" | "album" | "image",
    src: m.media_url as string | null,
    thumb: (m.thumbnail_url ?? m.media_url) as string | null,
    permalink: m.permalink as string,
    caption: m.caption as string | null,
    postedAt: m.posted_at as string,
    children: m.children as { type: string; src: string | null; thumb: string | null }[],
  }));
}

/** Every 30 minutes, plus shortly after start-up. Failures are recorded, never thrown. */
export function startInstagramSync(log: (msg: string) => void) {
  const run = () => sync().then((r) => r.count && log(`Instagram: synced ${r.count} posts`)).catch((e) => log(`Instagram sync failed: ${e instanceof Error ? e.message : e}`));
  setTimeout(run, 5_000).unref();
  setInterval(run, 30 * 60 * 1000).unref();
}
