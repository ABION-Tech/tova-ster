import type { MetadataRoute } from "next";
import { headers } from "next/headers";

/** Only tova-ster.com, once open, is listed by search engines; the preview and Railway addresses never are. */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = ((await headers()).get("x-forwarded-host") ?? (await headers()).get("host") ?? "").split(":")[0].toLowerCase();
  const main = (process.env.MAIN_HOSTS ?? "tova-ster.com,www.tova-ster.com").split(",").map((h) => h.trim().toLowerCase());
  if (!main.includes(host) || process.env.SITE_OPEN !== "true") return { rules: { userAgent: "*", disallow: "/" } };
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tova-ster.com";
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/account", "/checkout", "/unsubscribe", "/soon"] },
    sitemap: `${site}/sitemap.xml`,
  };
}
