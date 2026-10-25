import { Quiz } from "../../../components/tova/pages/Quiz";
export const metadata = { title: "Find your vitamins", description: "A few quick questions and a short list of Tova-Ster products made for you." };
export default async function Page({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  return <Quiz showResult={(await searchParams).result === "1"} />;
}
