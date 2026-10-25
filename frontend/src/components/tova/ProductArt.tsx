import type { Media } from "../../lib/tova/types";

/* Product pictures: the client's photo, or a plain "Photo to come" tile until one is uploaded. */
// Drawn packshots are switched off: only photos the client supplies are shown.
// A product with no photo yet shows the plain "Photo to come" tile.
const POTS: Record<string, { bg: string; body: string; label: string; band: string; bandInk: string; t1: string; t2: string; t3: string; ink: string; tub?: boolean }> = {};

function Pot({ slug }: { slug: string }) {
  const s = POTS[slug];
  const w = s.tub ? 230 : 190, x = (400 - w) / 2, top = s.tub ? 118 : 96, h = s.tub ? 220 : 248;
  return (
    <svg viewBox="0 0 400 400" role="img" aria-label={`Tova-Ster ${s.t1} ${s.t2}`} xmlns="http://www.w3.org/2000/svg">
      <rect width="400" height="400" fill={s.bg} />
      <ellipse cx="200" cy={top + h + 6} rx={w / 2 + 34} ry="14" fill="#000" fillOpacity=".08" />
      <rect x={x} y={top} width={w} height={h} rx={s.tub ? 18 : 26} fill={s.body} />
      <rect x={x + 8} y={top - 46} width={w - 16} height="54" rx="8" fill="#C99A3E" />
      <rect x={x + 8} y={top - 46} width={w - 16} height="10" rx="5" fill="#fff" fillOpacity=".25" />
      <rect x={x} y={top + 30} width={w} height={h - 52} fill={s.label} />
      <text x="200" y={top + 62} textAnchor="middle" fontFamily="Literata, Georgia, serif" fontSize="17" fontWeight="600" letterSpacing="2" fill="#B8882C">TOVA-STER</text>
      <text x="200" y={top + 76} textAnchor="middle" fontFamily="Instrument Sans, Arial, sans-serif" fontSize="6.5" letterSpacing="1.6" fill={s.tub ? "#BDB7AA" : "#6E685E"}>WELLNESS FOR YOUR WHOLE SELF</text>
      <text x="200" y={top + 112} textAnchor="middle" fontFamily="Literata, Georgia, serif" fontSize={s.tub ? 25 : 24} fontWeight="600" fill={s.ink}>{s.t1}</text>
      <text x="200" y={top + 138} textAnchor="middle" fontFamily="Literata, Georgia, serif" fontSize={s.tub ? 14 : 19} fontWeight="500" letterSpacing={s.tub ? 2 : 0} fill={s.ink}>{s.t2}</text>
      <rect x={x} y={top + h - 58} width={w} height="36" fill={s.band} />
      <text x="200" y={top + h - 35} textAnchor="middle" fontFamily="Instrument Sans, Arial, sans-serif" fontSize="11" fontWeight="700" letterSpacing="1.5" fill={s.bandInk}>{s.t3}</text>
    </svg>
  );
}

function BlankTile({ name }: { name: string }) {
  const lines: string[] = []; let cur = "";
  for (const w of name.split(" ")) { if ((cur + " " + w).trim().length > 16) { lines.push(cur.trim()); cur = w; } else cur += " " + w; }
  if (cur.trim()) lines.push(cur.trim());
  const shown = lines.slice(0, 3);
  return (
    <svg viewBox="0 0 400 400" role="img" aria-label={`${name}, photo to come`} xmlns="http://www.w3.org/2000/svg">
      <rect width="400" height="400" fill="#ECEAE5" />
      <image href="/brand/monogram.png" x="170" y="96" width="60" height="80" />
      {shown.map((l, i) => <text key={i} x="200" y={226 + i * 30} textAnchor="middle" fontFamily="Literata, Georgia, serif" fontSize="24" fontWeight="600" fill="#151413">{l}</text>)}
      <text x="200" y={240 + shown.length * 30} textAnchor="middle" fontFamily="Instrument Sans, Arial, sans-serif" fontSize="13" fill="#8A867F">Photo to come</text>
    </svg>
  );
}

/** First product photo, else a plain "Photo to come" tile. */
export function ProductArt({ slug, name, image, alt }: { slug: string; name: string; image?: string | null; alt?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  if (image) return <img src={image} alt={alt ?? `Tova-Ster ${name}`} loading="lazy" />;
  if (POTS[slug]) return <Pot slug={slug} />;
  return <BlankTile name={name} />;
}

/** Admin-managed image or video slot (homepage, banners, Instagram). */
export function MediaView({ media, alt = "", className, eager }: { media: Media | null | undefined; alt?: string; className?: string; eager?: boolean | "high" }) {
  if (!media?.src) return null;
  if (media.kind === "video") {
    return <video className={className} src={media.src} autoPlay loop muted playsInline preload="metadata" aria-label={alt} />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src={media.src} alt={alt} loading={eager ? "eager" : "lazy"} decoding="async" {...(eager === "high" ? { fetchPriority: "high" as const } : {})} />;
}
