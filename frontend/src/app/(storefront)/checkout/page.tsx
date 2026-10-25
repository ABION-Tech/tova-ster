import { Checkout } from "../../../components/tova/pages/Checkout";
export const metadata = { title: "Checkout", robots: { index: false } };
export default async function Page({ searchParams }: { searchParams: Promise<{ cancelled?: string }> }) {
  return <Checkout cancelled={(await searchParams).cancelled === "1"} />;
}
