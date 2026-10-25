import { Account } from "../../../components/tova/pages/Account";
export const metadata = { title: "Your account", robots: { index: false } };
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  return <Account next={(await searchParams).next ?? null} />;
}
