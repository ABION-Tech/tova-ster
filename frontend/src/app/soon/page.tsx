import type { Metadata } from "next";
import { SoonSignup } from "./SoonSignup";

export const metadata: Metadata = {
  title: { absolute: "Tova-Ster: launching soon" },
  description: "Tova-Ster is a UK supplement brand: everyday vitamins, minerals and gummies. Our shop opens soon. Join the list to hear first.",
  robots: { index: false, follow: false },
};

// The five launch products, client photos only. Names only: no pack sizes, no claims.
const RANGE = [
  { name: "Creatine Monohydrate Complex Powder", img: "/brand/creatine.jpg" },
  { name: "Multivitamin and Mineral for Children", img: "/brand/kids-multivitamin.jpg" },
  { name: "Iron & Vitamin C", img: "/brand/iron-vitamin-c.jpg" },
  { name: "Collagen Complex", img: "/brand/collagen.jpg" },
  { name: "Vitamin D3 4000iu", img: "/brand/vitamin-d3.jpg" },
];

export default function Soon() {
  return (
    <main className="soon">
      <header className="soon-top">
        <span className="logo"><img src="/brand/monogram.png" alt="" /><b>TOVA-STER</b></span>
      </header>

      <section className="soon-hero">
        <div className="soon-copy">
          <p className="soon-kicker">Launching soon in the UK</p>
          <h1>Everyday vitamins, minerals and gummies, delivered across the UK.</h1>
          <p className="soon-lede">Our shop opens soon. Join the list and we&rsquo;ll email you the day it opens, with news of launch offers.</p>
          <SoonSignup />
        </div>
        <div className="soon-photo"><img src="/brand/hero-collagen.jpg" alt="Tova-Ster Collagen Complex gummies" /></div>
      </section>

      <section className="soon-range" aria-labelledby="range">
        <h2 id="range">The launch range</h2>
        <ul>
          {RANGE.map((p) => (
            <li key={p.name}><div className="soon-well"><img src={p.img} alt={p.name} loading="lazy" /></div><span>{p.name}</span></li>
          ))}
        </ul>
      </section>

      <footer className="soon-foot">
        <a href="https://www.instagram.com/tovaster1/" rel="noopener">Instagram @tovaster1</a>
        <a href="mailto:info@tova-ster.com">info@tova-ster.com</a>
        <span>&copy; {new Date().getFullYear()} Tova-Ster</span>
      </footer>
    </main>
  );
}
