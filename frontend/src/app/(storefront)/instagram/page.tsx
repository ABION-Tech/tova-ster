import type { Metadata } from "next";
import { InstagramPage } from "../../../components/tova/Instagram";
import { getIgFeedServer } from "../../../lib/tova/api";

export const metadata: Metadata = { title: "Instagram @tovaster1", description: "Every post from the Tova-Ster Instagram: new products, how-tos and offers." };

export default async function Page() {
  return <InstagramPage initial={await getIgFeedServer()} />;
}
