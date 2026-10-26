"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { adminFetch, adminJson } from "../../lib/backend";
import { AdminContext, type AdminMe as Me } from "../../lib/admin/AdminContext";
import "../../styles/admin.css"; // the demo's admin look (shell classes live in tova.css)

interface AdminMe {
  admin: Me;
  areas: string[];
  twoStep?: { enabled: boolean; required: boolean };
}

// Grouped like the demo. Each link belongs to an area; the server says which
// areas this person's role may open, and only those are shown.
const NAV: { group: string; links: { href: string; label: string; area: string }[] }[] = [
  { group: "Overview", links: [
    { href: "/admin", label: "Dashboard", area: "dashboard" },
    { href: "/admin/orders", label: "Orders", area: "orders" },
    { href: "/admin/customers", label: "Customers", area: "customers" },
    { href: "/admin/baskets", label: "Baskets", area: "baskets" },
    { href: "/admin/activity", label: "Activity", area: "activity" },
  ] },
  { group: "Catalogue", links: [
    { href: "/admin/products", label: "Products", area: "products" },
    { href: "/admin/categories", label: "Categories", area: "categories" },
    { href: "/admin/reviews", label: "Reviews", area: "reviews" },
  ] },
  { group: "Grow", links: [
    { href: "/admin/homepage", label: "Homepage & media", area: "homepage" },
    { href: "/admin/growth", label: "Growth tools", area: "growth" },
    { href: "/admin/emails", label: "Emails", area: "emails" },
    { href: "/admin/offers", label: "Bundles & codes", area: "offers" },
    { href: "/admin/instagram", label: "Instagram", area: "instagram" },
  ] },
  { group: "Setup", links: [
    { href: "/admin/team", label: "Team & access", area: "team" },
    { href: "/admin/security", label: "Two-step sign-in", area: "security" },
  ] },
];
const ALL_LINKS = NAV.flatMap((g) => g.links);
const areaOf = (path: string) =>
  [...ALL_LINKS].sort((a, b) => b.href.length - a.href.length).find((l) => path === l.href || path.startsWith(`${l.href}/`))?.area;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "TS";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isOpenPage = pathname === "/admin/login" || pathname === "/admin/accept-invite";

  const [admin, setAdmin] = useState<AdminMe["admin"] | null>(null);
  const [areas, setAreas] = useState<string[]>([]);
  const [checked, setChecked] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [needsTwoStep, setNeedsTwoStep] = useState(false);

  // Session cookie can expire mid-session (12h TTL): re-check on every page
  // change so a stale tab goes to sign-in instead of a page full of errors.
  useEffect(() => {
    setNavOpen(false);
    if (isOpenPage) { setChecked(true); return; }
    adminJson<AdminMe>("/admin/auth/me")
      .then((d) => {
        setAdmin(d.admin); setAreas([...(d.areas ?? []), "security"]);
        setNeedsTwoStep(Boolean(d.twoStep?.required && !d.twoStep.enabled));
      })
      .catch(() => router.replace("/admin/login"))
      .finally(() => setChecked(true));
  }, [pathname, isOpenPage, router]);

  async function signOut() {
    await adminFetch("/admin/auth/logout", { method: "POST" });
    router.push("/admin/login");
  }

  if (isOpenPage) return <>{children}</>;
  if (!checked || !admin) {
    return <div style={{ minHeight: "100vh", background: "var(--black)", color: "#CFCBC2", display: "grid", placeItems: "center", fontSize: 14 }}>{checked ? "" : "Checking your sign-in…"}</div>;
  }

  const groups = NAV.map((g) => ({ ...g, links: g.links.filter((l) => areas.includes(l.area)) })).filter((g) => g.links.length);
  const links = groups.flatMap((g) => g.links);
  const area = areaOf(pathname);
  const allowed = !area || areas.includes(area);
  const current = links.find((l) => l.area === area)?.label ?? "Admin";
  const isCurrent = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`));

  return (
    <div className="admin">
      <div className="atop">
        <button className="btn sm light" onClick={() => setNavOpen(true)} aria-expanded={navOpen} aria-controls="adminside">Menu</button>
        <b>{current}</b>
        <span className="brandmini">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/brand/monogram.png" alt="" />Tova-Ster</span>
      </div>
      {navOpen && <div className="scrim anavscrim" onClick={() => setNavOpen(false)} />}
      <aside className={`side${navOpen ? " open" : ""}`} id="adminside" aria-label="Admin">
        <div className="brand">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/brand/monogram.png" alt="" /><b>Tova-Ster</b></div>
        {groups.map((g) => (
          <div key={g.group}>
            <div className="grp">{g.group}</div>
            {g.links.map((l) => (
              <Link key={l.href} href={l.href} className="nav" aria-current={isCurrent(l.href) ? "page" : undefined}>{l.label}</Link>
            ))}
          </div>
        ))}
        <div className="spacer" />
        <a className="nav" href="/" target="_blank" rel="noopener">View the shop</a>
        <div className="whoami">
          <span className="avatar">{initials(admin.name)}</span>
          <span>{admin.name}<br /><small>{admin.role}</small></span>
          <button onClick={signOut}>Sign out</button>
        </div>
      </aside>
      <main className="amain">
        <AdminContext.Provider value={{ admin, areas }}>
          {needsTwoStep && pathname !== "/admin/security" ? (
            <div className="acard" style={{ maxWidth: 560 }}>
              <h2>Set up two-step sign-in first</h2>
              <p className="muted">The team signs in with a password and a code from an authenticator app. It takes about a minute.</p>
              <div><Link href="/admin/security" className="btn sm">Set it up now</Link></div>
            </div>
          ) : allowed ? children : (
            <div className="acard" style={{ maxWidth: 560 }}>
              <h2>Not part of your role</h2>
              <p className="muted">Your role ({admin.role}) doesn&apos;t include this page. Ask the owner if you need it.</p>
              <div><Link href={links[0]?.href ?? "/admin"} className="btn sm">Go to {links[0]?.label ?? "Dashboard"}</Link></div>
            </div>
          )}
        </AdminContext.Provider>
      </main>
    </div>
  );
}
