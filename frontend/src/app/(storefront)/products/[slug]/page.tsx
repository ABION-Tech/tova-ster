import type { Metadata } from "next";
import { ProductPage } from "../../../../components/tova/pages/ProductPage";
import { getCatalogueServer } from "../../../../lib/tova/api";

type Props = { params: Promise<{ slug: string }> };

async function find(slug: string) {
  return (await getCatalogueServer())?.find((p) => p.slug === slug) ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await find((await params).slug);
  if (!p) return { title: "Product not found" };
  const image = p.images[0]?.url;
  return {
    title: p.name,
    description: `${p.short_description ?? p.name}. £${p.price.toFixed(2)}, free UK delivery over £40.`,
    alternates: { canonical: `/products/${p.slug}` },
    openGraph: { title: p.name, description: p.short_description ?? undefined, images: image ? [image] : undefined },
  };
}

export default async function Page({ params }: Props) {
  const { slug } = await params;
  const p = await find(slug);
  // Product data for Google Shopping / rich results.
  const ld = p ? {
    "@context": "https://schema.org", "@type": "Product", name: p.name, description: p.description ?? p.short_description,
    image: p.images.map((i) => i.url), brand: { "@type": "Brand", name: "Tova-Ster" }, sku: p.slug,
    offers: { "@type": "Offer", priceCurrency: "GBP", price: p.price.toFixed(2), availability: p.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock", url: `/products/${p.slug}` },
    ...(p.rating ? { aggregateRating: { "@type": "AggregateRating", ratingValue: p.rating, reviewCount: p.review_count } } : {}),
  } : null;
  return (
    <>
      {ld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />}
      <ProductPage slug={slug} />
    </>
  );
}
