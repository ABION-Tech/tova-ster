import { TestPay } from "../../../../components/tova/pages/Confirmation";
export const metadata = { title: "Test payment", robots: { index: false } };
export default async function Page({ searchParams }: { searchParams: Promise<{ reference?: string }> }) {
  return <TestPay reference={(await searchParams).reference ?? null} />;
}
