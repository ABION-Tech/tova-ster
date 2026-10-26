"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { adminFetch, adminJson } from "../../lib/backend";
import styles from "./layout.module.css";
import "../../styles/globals.css"; // old admin look until the admin is rebuilt on the Tova-Ster design

import { AdminContext, type AdminMe as Me } from "../../lib/admin/AdminContext";

interface AdminMe {
  admin: Me;
  areas: string[];
}

// Each link belongs to an area; the server says which areas this person's role may open.
const NAV_LINKS = [
  { href: "/admin", label: "Dashboard", area: "dashboard" },
  { href: "/admin/orders", label: "Orders", area: "orders" },
  { href: "/admin/baskets", label: "Baskets", area: "baskets" },
  { href: "/admin/products", label: "Products", area: "products" },
  { href: "/admin/categories", label: "Categories", area: "categories" },
  { href: "/admin/reviews", label: "Reviews", area: "reviews" },
  { href: "/admin/homepage", label: "Homepage", area: "homepage" },
  { href: "/admin/growth", label: "Growth tools", area: "growth" },
  { href: "/admin/instagram", label: "Instagram", area: "instagram" },
  { href: "/admin/team", label: "Team", area: "team" },
];
const areaOf = (path: string) =>
  [...NAV_LINKS].sort((a, b) => b.href.length - a.href.length).find((l) => path === l.href || path.startsWith(`${l.href}/`))?.area;

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLoginPage = pathname === "/admin/login" || pathname === "/admin/accept-invite";

  const [admin, setAdmin] = useState<AdminMe["admin"] | null>(null);
  const [areas, setAreas] = useState<string[]>([]);
  const [checked, setChecked] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (isLoginPage) {
      setChecked(true);
      return;
    }
    adminJson<AdminMe>("/admin/auth/me")
      .then((data) => { setAdmin(data.admin); setAreas(data.areas ?? []); })
      .catch(() => router.replace("/admin/login"))
      .finally(() => setChecked(true));
  }, [isLoginPage, router]);

  // Session cookie can expire mid-session (12h TTL) — re-check on every
  // route change so a stale tab gets bounced to login instead of showing
  // a page full of 401s.
  useEffect(() => {
    setMobileNavOpen(false);
    if (isLoginPage || !checked) return;
    adminJson<AdminMe>("/admin/auth/me")
      .then((data) => { setAdmin(data.admin); setAreas(data.areas ?? []); })
      .catch(() => router.replace("/admin/login"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  async function handleLogout() {
    await adminFetch("/admin/auth/logout", { method: "POST" });
    router.push("/admin/login");
  }

  if (isLoginPage) return <>{children}</>;

  if (!checked) {
    return (
      <div style={{ padding: 48, textAlign: "center", color: "var(--ink-muted)", fontSize: 14 }}>
        Checking admin session…
      </div>
    );
  }
  if (!admin) return null; // redirect already in flight
  const links = NAV_LINKS.filter((l) => areas.includes(l.area));
  const area = areaOf(pathname);
  const allowed = !area || areas.includes(area);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <nav className={styles.nav}>
        <Link href="/admin" className={styles.brand}>
          Tova-Ster Admin
        </Link>
        <div className={styles.links} style={{ display: "flex", gap: 4 }}>
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={`${styles.link} ${pathname === l.href ? styles.linkActive : ""}`}>
              {l.label}
            </Link>
          ))}
        </div>
        <span className={styles.adminName}>{admin.name} · {admin.role}</span>
        <button onClick={handleLogout} className={styles.logoutBtn} style={{ marginLeft: 12 }}>
          Log out
        </button>
        <button className={styles.hamburger} aria-label="Open admin menu" onClick={() => setMobileNavOpen((o) => !o)}>
          <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="var(--ink)" strokeWidth={1.6}>
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
      </nav>

      {mobileNavOpen && (
        <div className={styles.mobileMenu}>
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`${styles.link} ${pathname === l.href ? styles.linkActive : ""}`}
              onClick={() => setMobileNavOpen(false)}
            >
              {l.label}
            </Link>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 10px 0" }}>
            <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>{admin.name}</span>
            <button onClick={handleLogout} className={styles.logoutBtn}>
              Log out
            </button>
          </div>
        </div>
      )}

      <div className={styles.content}>
        <AdminContext.Provider value={{ admin, areas }}>
          {allowed ? children : (
            <div style={{ padding: 24, border: "1px solid #E2DFD9", borderRadius: 12, background: "#fff", maxWidth: 560 }}>
              <h1 style={{ marginTop: 0 }}>Not part of your role</h1>
              <p>Your role ({admin.role}) doesn&apos;t include this page. Ask the owner if you need it.</p>
              <Link href={links[0]?.href ?? "/admin"} className="btn">Go to {links[0]?.label ?? "Dashboard"}</Link>
            </div>
          )}
        </AdminContext.Provider>
      </div>
    </div>
  );
}
