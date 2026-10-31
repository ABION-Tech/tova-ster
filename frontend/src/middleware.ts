import { NextResponse, type NextRequest } from "next/server";

/**
 * The main web address (tova-ster.com) before launch.
 *
 * MAIN_HOSTS     the shop's public addresses (default tova-ster.com, www.tova-ster.com)
 * SITE_OPEN      "true" opens the full shop there (launch day). Until then
 *                visitors see the launching-soon page and can join the email list.
 * PREVIEW_KEY    tova-ster.com/?preview=<key> lets the team and client into the
 *                full shop on the main address (remembered for 30 days).
 *
 * Every other address (preview.tova-ster.com, the Railway address) always has
 * the full shop, but is kept out of search engines so Google only ever lists
 * tova-ster.com. www is sent to the plain address.
 */
const MAIN = (process.env.MAIN_HOSTS ?? "tova-ster.com,www.tova-ster.com").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
const OPEN = process.env.SITE_OPEN === "true";
const KEY = process.env.PREVIEW_KEY ?? "";
const COOKIE = "tova_preview";
// What the launching-soon page itself needs, plus pages linked from emails already sent.
const ALWAYS = [/^\/soon$/, /^\/unsubscribe/, /^\/robots\.txt$/, /^\/sitemap\.xml$/, /^\/brand\//, /^\/fonts\//, /^\/downloads\//, /^\/favicon/];

export function middleware(req: NextRequest) {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(":")[0].toLowerCase();
  const url = req.nextUrl;

  if (!MAIN.includes(host)) {
    const res = NextResponse.next();
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
    return res;
  }

  if (host.startsWith("www.")) {
    const to = new URL(url.pathname + url.search, `https://${host.slice(4)}`);
    return NextResponse.redirect(to, 301);
  }

  if (OPEN) return NextResponse.next();

  // ?preview=<key> → remember, then show the same page without the key in the address.
  const asked = url.searchParams.get("preview");
  if (KEY && asked !== null) {
    const clean = new URLSearchParams(url.search);
    clean.delete("preview");
    const q = clean.toString();
    const res = NextResponse.redirect(new URL(url.pathname + (q ? `?${q}` : ""), `https://${host}`), 302);
    if (asked === KEY) res.cookies.set(COOKIE, KEY, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 30, path: "/" });
    else if (asked === "off") res.cookies.delete(COOKIE);
    return res;
  }
  if (KEY && req.cookies.get(COOKIE)?.value === KEY) {
    const res = NextResponse.next();
    res.headers.set("X-Robots-Tag", "noindex, nofollow"); // the full shop isn't public yet
    return res;
  }

  if (ALWAYS.some((r) => r.test(url.pathname))) return NextResponse.next();
  const soon = url.clone();
  soon.pathname = "/soon";
  soon.search = "";
  return NextResponse.rewrite(soon);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|api/).*)"],
};
