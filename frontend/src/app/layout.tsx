import "../styles/tova.css";

export const metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://tova-ster.com"),
  title: { default: "Tova-Ster: UK vitamins, minerals and gummies", template: "%s | Tova-Ster" },
  description: "Tova-Ster is a UK supplement brand: everyday vitamins, minerals and gummies for adults, children and training, delivered across the UK.",
  icons: { icon: "/brand/monogram.png" },
  openGraph: { siteName: "Tova-Ster", locale: "en_GB", type: "website" },
};

export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#FFFFFF" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <head>
        <link rel="preload" href="/fonts/instrument-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/fonts/literata-latin-500-normal.woff2" as="font" type="font/woff2" crossOrigin="" />
      </head>
      <body>{children}</body>
    </html>
  );
}
