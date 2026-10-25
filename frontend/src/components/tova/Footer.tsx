"use client";

import Link from "next/link";
import { useShop } from "./ShopProvider";
import { NEEDS, shopHref } from "../../lib/tova/shop";
import { PayMarks } from "./PayMarks";

export function Footer() {
  const { store } = useShop();
  if (!store) return null;
  const pay = store.features.payments;
  const b = store.business;
  const insta = store.site.insta;
  return (
    <footer className="site"><div className="wrap">
      <div className="fcols">
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <Link className="logo" href="/" style={{ color: "#fff" }}><img src="/brand/monogram.png" alt="" /><b style={{ color: "#fff" }}>TOVA-STER</b></Link>
          <p style={{ fontSize: 14, maxWidth: "30em" }}>Wellness for your whole self. Vitamins, minerals and gummies for adults, children and training, delivered across the UK.</p>
          <p style={{ fontSize: 14 }}><a href={`mailto:${b.email}`} style={{ color: "inherit" }}>{b.email}</a><br />{b.web}</p>
          {insta.on && insta.handle && <Link href="/instagram" style={{ color: "#fff", fontWeight: 600, fontSize: 14 }}>Instagram @{insta.handle}</Link>}
          <PayMarks payments={pay} />
        </div>
        <div><h4>Shop</h4><ul>{NEEDS.slice(0, 5).map((n) => <li key={n.id}><Link href={shopHref({ need: n.id })}>{n.name}</Link></li>)}<li><Link href="/shop">Shop all</Link></li></ul></div>
        <div><h4>Help</h4><ul>
          <li><Link href="/help#delivery">Delivery & returns</Link></li>
          {store.features.subscribe.on && <li><Link href="/help#subscriptions">Subscriptions</Link></li>}
          {store.features.rewards.on && <li><Link href="/help#points">Reward points</Link></li>}
          <li><Link href="/help#contact">Contact us</Link></li>
        </ul></div>
        <div><h4>Company</h4><ul>
          <li><Link href="/help#quality">Quality & safety</Link></li>
          <li><Link href="/help#privacy">Privacy & cookies</Link></li>
          <li><Link href="/help#terms">Terms</Link></li>
        </ul></div>
      </div>
      <div className="legal">
        <span>Food supplements should not be used as a substitute for a varied, balanced diet and a healthy lifestyle. Do not exceed the recommended daily dose.</span>
        <span>© {new Date().getFullYear()} {b.name}, {b.web}</span>
      </div>
    </div></footer>
  );
}
