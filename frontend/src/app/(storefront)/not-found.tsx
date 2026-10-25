import Link from "next/link";
export default function NotFound() {
  return <main className="wrap"><div className="empty" style={{ marginTop: 40 }}><b>We can&apos;t find that page</b><p>It may have moved. Try the shop or the search at the top.</p><Link className="btn sm" href="/shop">Shop all products</Link></div></main>;
}
