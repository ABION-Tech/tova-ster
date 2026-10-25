import type { Metadata } from "next";
import { Shop, type ShopFilters } from "../../../components/tova/pages/Shop";

export const metadata: Metadata = { title: "Shop vitamins, minerals and gummies", description: "The Tova-Ster range: Vitamin D3 4000iu, Iron & Vitamin C, Collagen Complex, Multivitamin and Mineral for Children, and Creatine Monohydrate. Free UK delivery over £40." };

export default async function ShopPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).slice(0, 80) : undefined);
  const filters: ShopFilters = { need: one("need"), who: one("who"), format: one("format"), q: one("q"), sort: one("sort") };
  return <Shop filters={filters} />;
}
