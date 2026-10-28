import { Suspense } from "react";
import { Unsubscribe } from "../../../components/tova/pages/Unsubscribe";
export const metadata = { title: "Unsubscribe", robots: { index: false } };
export default function Page() { return <Suspense><Unsubscribe /></Suspense>; }
