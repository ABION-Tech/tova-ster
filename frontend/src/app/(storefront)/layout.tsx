import { ShopProvider } from "../../components/tova/ShopProvider";
import { Header } from "../../components/tova/Header";
import { Footer } from "../../components/tova/Footer";
import { Overlays } from "../../components/tova/Overlays";
import { getCatalogueServer, getStorefrontServer } from "../../lib/tova/api";

/**
 * Catalogue and settings are fetched on the server (cached 30s) so every page
 * arrives with real content. If the backend can't be reached, the browser's
 * remembered copy is used instead (see ShopProvider).
 */
export default async function StorefrontLayout({ children }: { children: React.ReactNode }) {
  const [products, store] = await Promise.all([getCatalogueServer(), getStorefrontServer()]);
  return (
    <ShopProvider initialProducts={products} initialStore={store}>
      <a className="sr" href="#main">Skip to content</a>
      <Header />
      <div id="main">{children}</div>
      <Footer />
      <Overlays />
    </ShopProvider>
  );
}
