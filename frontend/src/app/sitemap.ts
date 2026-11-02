import type { MetadataRoute } from "next";
import { getCatalogueServer } from "../lib/tova/api";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tova-ster.co.uk";
  const pages = ["", "/shop", "/offers", "/quiz", "/help", "/instagram"].map((p) => ({ url: `${site}${p}`, changeFrequency: "weekly" as const, priority: p === "" ? 1 : 0.6 }));
  const products = ((await getCatalogueServer()) ?? []).filter((p) => !(p as { hidden?: boolean }).hidden)
    .map((p) => ({ url: `${site}/products/${p.slug}`, changeFrequency: "weekly" as const, priority: 0.8 }));
  return [...pages, ...products];
}
