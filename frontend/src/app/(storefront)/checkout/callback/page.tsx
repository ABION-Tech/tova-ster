import { Confirmation } from "../../../../components/tova/pages/Confirmation";
export const metadata = { title: "Order confirmed", robots: { index: false } };
export default async function Page({ searchParams }: { searchParams: Promise<{ reference?: string }> }) {
  return <Confirmation reference={(await searchParams).reference ?? null} />;
}
